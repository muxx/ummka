import { useEffect, useMemo, useRef, useState } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { PendingPost } from "../mattermost/account-delivery.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import {
  conversationRows,
  type OutgoingPlacement,
} from "./conversation-rows.ts";
import { OutgoingRowActions } from "./OutgoingRowActions.tsx";
import { outgoingCopy, outgoingDescription } from "./outgoing-copy.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { channelPageSize, workspaceFailure } from "./workspace-data.ts";

export type OutgoingAccount = Pick<
  WorkspaceConnection,
  | "rid"
  | "subscribeToPostActivity"
  | "readPendingPosts"
  | "retireDeliveredPosts"
  | "getOutgoingPostState"
  | "dismissPendingPost"
  | "resendPost"
>;
type Props = {
  connection: OutgoingAccount;
  channelId: string;
  rootId?: string;
  userId: string;
  history: readonly LocalPost[];
  placement: OutgoingPlacement;
  locale: EntryLanguage;
  enabled?: boolean;
  accepted?: () => void;
  sessionIssue: (issue: "session" | "unauthorized") => void;
};
type Slice = {
  records: PendingPost[];
  more: boolean;
  pages: number;
  failed: boolean;
};
const emptySlice: Slice = { records: [], more: false, pages: 0, failed: false };

async function readOutgoingPages(
  connection: OutgoingAccount,
  channelId: string,
  rootId: string | undefined,
  pages: number,
  signal: AbortSignal,
) {
  const records: PendingPost[] = [];
  let before: PendingPost["sequence"] | undefined;
  let more = false;
  for (let i = 0; i < pages; i++) {
    const rows = await connection.readPendingPosts({
      channelId,
      rootId,
      before,
      limit: channelPageSize + 1,
    });
    if (signal.aborted) return null;
    more = rows.length > channelPageSize;
    records.push(...rows.slice(0, channelPageSize));
    if (!more) break;
    before = rows[channelPageSize - 1].sequence;
  }
  return { records, more, pages, failed: false };
}

/** The caller keys the conversation by account, channel and root. History is newest first. */
export function useConversationOutgoing({
  connection,
  channelId,
  rootId,
  userId,
  history,
  placement,
  locale,
  enabled = true,
  accepted,
  sessionIssue,
}: Props) {
  const [pages, setPages] = useState(1);
  const [actionNotice, notify] = useState("");
  const retry = useRef<(() => void) | null>(null);
  const [slice, setSlice] = useState(emptySlice);
  const copy = outgoingCopy[locale];
  useEffect(() => {
    if (!enabled) {
      setSlice(emptySlice);
      return;
    }
    const controller = new AbortController();
    let reading = false;
    let requested = false;
    async function refresh() {
      requested = true;
      if (reading) return;
      reading = true;
      try {
        while (requested && !controller.signal.aborted) {
          requested = false;
          const result = await readOutgoingPages(
            connection,
            channelId,
            rootId,
            pages,
            controller.signal,
          );
          if (!result) return;
          if (requested) continue;
          setSlice(result);
          if (history.length && result.records.length) {
            const { matched } = conversationRows(
              history,
              result.records,
              channelId,
              rootId ?? null,
              userId,
              "hidden",
            );
            if (
              matched.length &&
              (await connection.retireDeliveredPosts(matched)) > 0
            )
              requested = true;
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const issue = workspaceFailure(error, "storage");
        if (issue === "session" || issue === "unauthorized") {
          controller.abort();
          setSlice(emptySlice);
          sessionIssue(issue);
        } else {
          setSlice((current) => ({
            ...(issue === "forbidden" ? emptySlice : current),
            failed: true,
          }));
        }
      } finally {
        reading = false;
        if (requested && !controller.signal.aborted) void refresh();
      }
    }
    const changed = () => {
      void refresh();
    };
    const visible = () => {
      if (!document.hidden) changed();
    };
    const unsubscribe = connection.subscribeToPostActivity(
      { channelId, rootId },
      changed,
    );
    window.addEventListener("focus", changed);
    document.addEventListener("visibilitychange", visible);
    retry.current = changed;
    changed();
    return () => {
      controller.abort();
      retry.current = null;
      unsubscribe();
      window.removeEventListener("focus", changed);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [
    connection,
    channelId,
    rootId,
    userId,
    history,
    pages,
    sessionIssue,
    enabled,
  ]);

  const visible = enabled ? slice : emptySlice;
  const { messages, afterGap } = useMemo(
    () =>
      conversationRows(
        history,
        visible.records,
        channelId,
        rootId ?? null,
        userId,
        placement,
      ),
    [history, visible.records, channelId, rootId, userId, placement],
  );
  return {
    messages,
    afterGap,
    ownName: copy.you,
    renderOutgoing(post: PendingPost) {
      const state = connection.getOutgoingPostState(post);
      const description = outgoingDescription(state, locale);
      return (
        <>
          {description && (
            <small className="timeline-delivery">{description}</small>
          )}
          <OutgoingRowActions
            key={JSON.stringify([
              post.attempt,
              state.actions.retry !== undefined,
            ])}
            post={post}
            state={state}
            locale={locale}
            dismiss={connection.dismissPendingPost}
            resend={connection.resendPost}
            refresh={() => retry.current?.()}
            notify={notify}
            accepted={accepted}
            sessionIssue={sessionIssue}
          />
        </>
      );
    },
    localNotice: enabled && (
      <>
        {actionNotice && (
          <div className="workspace-notice" role="status">
            {actionNotice}
          </div>
        )}
        {slice.failed && (
          <div className="workspace-notice" role="alert">
            {copy.readFailed}
            <button type="button" onClick={() => retry.current?.()}>
              {copy.retry}
            </button>
          </div>
        )}
        {placement !== "hidden" && slice.more && (
          <div className="timeline-boundary">
            <button
              type="button"
              disabled={slice.pages !== pages}
              onClick={() => setPages((n) => n + 1)}
            >
              {copy.earlier}
            </button>
          </div>
        )}
      </>
    ),
  };
}
