import { useEffect, useRef, useState } from "react";
import type { TeamWorkspace } from "../entry/AccountTeamWindow.tsx";
import { directoryProblem } from "../mattermost/account-directory-error.ts";

type Step = "write" | "refresh";

export function useReopenConversation({
  connection,
  team,
  policy,
  sessionIssue,
}: TeamWorkspace) {
  const inFlight = useRef(new Map<string, AbortController>());
  const [failures, setFailures] = useState<Record<string, Step>>({});
  useEffect(() => {
    const requests = inFlight.current;
    return () => {
      for (const controller of requests.values()) controller.abort();
      requests.clear();
    };
  }, []);

  async function run(id: string, initialStep: Step) {
    if (!navigator.onLine || inFlight.current.has(id)) return;
    const controller = new AbortController();
    const { signal } = controller;
    inFlight.current.set(id, controller);
    let step = initialStep;
    try {
      if (step === "write") {
        const outcome = await connection.reopenKnownConversation(
          team.id,
          id,
          signal,
        );
        signal.throwIfAborted();
        if (outcome === "confirmed") step = "refresh";
      }
      if (step === "refresh") {
        const published = await connection.refreshJoinedTeams(signal);
        signal.throwIfAborted();
        if (!published) {
          setFailures((previous) => ({ ...previous, [id]: step }));
          return;
        }
      }
      policy.reloadUser();
      setFailures((previous) => {
        if (!(id in previous)) return previous;
        const next = { ...previous };
        delete next[id];
        return next;
      });
    } catch (error) {
      if (signal.aborted) return;
      const issue = directoryProblem(error);
      if (issue === "session" || issue === "unauthorized") sessionIssue(issue);
      else setFailures((previous) => ({ ...previous, [id]: step }));
    } finally {
      inFlight.current.delete(id);
    }
  }
  return {
    open: (id: string) => run(id, "write"),
    retry(id: string) {
      const step = failures[id];
      if (step) return run(id, step);
    },
    failures,
  };
}
