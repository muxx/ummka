import { useEffect, useEffectEvent, useState } from "react";
import type { ChannelProfile } from "../mattermost/channel-profiles.ts";
import type { RecipientPage } from "../mattermost/conversation-recipients.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";

type PageRequest = {
  term: string;
  page: number;
  previous: ChannelProfile[];
  retry: boolean;
};
const firstPage = (term: string): PageRequest => ({
  term,
  page: 0,
  previous: [],
  retry: false,
});
type PageState = RecipientPage & {
  status: "loading" | "checking" | "ready" | "failed" | "offline" | "denied";
  focus?: string;
  added?: number;
};

export function useConversationRecipientPages(
  account: Pick<WorkspaceConnection, "readConversationRecipients">,
  teamId: string,
  online: boolean,
  sessionIssue: (issue: "unauthorized" | "session") => void,
) {
  const [request, setRequest] = useState(() => firstPage(""));
  const [result, setResult] = useState<{
    request: PageRequest;
    state: PageState;
  }>();
  const onSessionIssue = useEffectEvent(sessionIssue);
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    const { signal } = controller;
    function publish(state: PageState) {
      if (!signal.aborted) setResult({ request, state });
    }
    async function load() {
      const { page, term, previous, retry } = request;
      const completed = new Map(previous.map((person) => [person.id, person]));
      function join(profiles: ChannelProfile[]) {
        const joined = new Map(completed);
        for (const person of profiles) joined.set(person.id, person);
        return [...joined.values()];
      }
      let local: Set<string> | undefined;
      publish({ status: "loading", profiles: previous, nextPage: null });
      try {
        const next = await account.readConversationRecipients(
          teamId,
          term ? { kind: "search", term } : { kind: "page", page },
          signal,
          (partial) => {
            if (signal.aborted) return;
            local = new Set(partial.profiles.map(({ id }) => id));
            publish({
              status: "checking",
              profiles: join(partial.profiles),
              nextPage: null,
            });
          },
        );
        const firstNew = next.profiles.find(({ id }) => !completed.has(id));
        publish({
          status: "ready",
          profiles: join(next.profiles),
          nextPage: next.nextPage,
          added:
            local &&
            next.profiles.filter(
              ({ id }) => !local?.has(id) && !completed.has(id),
            ).length,
          focus: retry
            ? page > 0 && firstNew
              ? firstNew.id
              : "search"
            : undefined,
        });
      } catch (error) {
        if (signal.aborted) return;
        const issue = workspaceFailure(error, "network");
        if (issue === "session" || issue === "unauthorized")
          onSessionIssue(issue);
        const denied = ["forbidden", "session", "unauthorized"].includes(issue);
        publish({
          status: denied ? "denied" : "failed",
          profiles: denied ? [] : previous,
          nextPage: null,
          focus: denied ? undefined : "retry",
        });
      }
    }
    void load();
    return () => controller.abort();
  }, [account, teamId, online, request]);
  const state: PageState = !online
    ? { status: "offline", profiles: [], nextPage: null }
    : result?.request === request
      ? result.state
      : { status: "loading", profiles: request.previous, nextPage: null };

  useEffect(() => {
    if (!online) setRequest((previous) => firstPage(previous.term));
  }, [online]);

  return {
    state,
    term: request.term,
    page: request.page,
    search: (term: string) => setRequest(firstPage(term)),
    next: () => {
      if (state.status === "failed") setRequest({ ...request, retry: true });
      else if (state.status === "ready" && state.nextPage !== null)
        setRequest({
          term: request.term,
          page: state.nextPage,
          previous: state.profiles,
          retry: false,
        });
    },
  };
}
