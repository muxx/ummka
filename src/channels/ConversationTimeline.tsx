import { useEffect, useMemo, useRef, useState } from "react";
import type { PendingPost } from "../mattermost/account-delivery.ts";
import { ChannelTimeline, type TimelineProps } from "./ChannelTimeline.tsx";
import { conversationRows } from "./conversation-rows.ts";
import { outgoingCopy, outgoingDescription } from "./outgoing-copy.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { channelPageSize, workspaceFailure } from "./workspace-data.ts";

type Account = Pick<
  WorkspaceConnection,
  | "rid"
  | "subscribeToPostActivity"
  | "readPendingPosts"
  | "retireDeliveredPosts"
  | "getOutgoingPostState"
>;
type Props = TimelineProps & {
  connection: Account;
  userId: string;
  rootId?: string;
  latest: boolean;
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
  connection: Account,
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

export function ConversationTimeline(props: Props) {
  return (
    <Conversation
      key={JSON.stringify([
        props.connection.rid,
        props.channelId,
        props.rootId,
      ])}
      {...props}
    />
  );
}

function Conversation({
  connection,
  userId,
  rootId,
  sessionIssue,
  latest,
  ...timeline
}: Props) {
  const { channelId, page, locale } = timeline;
  const [pages, setPages] = useState(1);
  const retry = useRef<(() => void) | null>(null);
  const [slice, setSlice] = useState(emptySlice);
  const copy = outgoingCopy[locale];
  useEffect(() => {
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
          if (page?.posts.length && result.records.length) {
            const { matched } = conversationRows(
              page.posts,
              result.records,
              channelId,
              rootId ?? null,
              userId,
              false,
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
  }, [connection, channelId, rootId, userId, page, pages, sessionIssue]);

  const { messages } = useMemo(
    () =>
      conversationRows(
        page?.posts ?? [],
        slice.records,
        channelId,
        rootId ?? null,
        userId,
        latest,
      ),
    [page, slice.records, channelId, rootId, userId, latest],
  );
  return (
    <ChannelTimeline
      {...timeline}
      messages={messages}
      ownName={copy.you}
      describeOutgoing={(post) =>
        outgoingDescription(connection.getOutgoingPostState(post), locale)
      }
      localNotice={
        <>
          {slice.failed && (
            <div className="workspace-notice" role="alert">
              {copy.readFailed}
              <button type="button" onClick={() => retry.current?.()}>
                {copy.retry}
              </button>
            </div>
          )}
          {latest && slice.more && (
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
      }
    />
  );
}
