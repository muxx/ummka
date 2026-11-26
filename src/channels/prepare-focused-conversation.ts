import type { LocalPost } from "../mattermost/local-history.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

type Account = Pick<
  WorkspaceConnection,
  "readChannelWindow" | "refreshChannelHistory"
>;

const neighbors = 30;

/** Prepare the channel around a resolved navigation target on the same account. */
export async function prepareFocusedConversation(
  account: Account,
  post: LocalPost,
  collapsedThreads: boolean,
  signal: AbortSignal,
  online = true,
) {
  signal.throwIfAborted();
  const focusedReply = collapsedThreads && post.rootId ? post : undefined;
  const anchorId = focusedReply?.rootId ?? post.id;
  const scope = {
    channelId: post.channelId,
    collapsedThreads,
    postId: anchorId,
  };
  const around = {
    ...scope,
    kind: "around" as const,
    older: neighbors,
    newer: neighbors,
  };
  let page = await account.readChannelWindow(around);
  signal.throwIfAborted();
  if (!page) {
    if (!online) return { status: "offline" } as const;
    const result = await account.refreshChannelHistory(
      { ...scope, kind: "focused", perPage: neighbors },
      signal,
    );
    signal.throwIfAborted();
    if (result.kind === "superseded") return { status: "superseded" } as const;
    if (result.kind === "inaccessible")
      return {
        status: "inaccessible",
        firstInaccessiblePostTime: result.firstInaccessiblePostTime,
      } as const;
    page = await account.readChannelWindow(around);
    signal.throwIfAborted();
  }
  if (
    !page?.posts.some(
      (row) => row.id === anchorId && row.channelId === scope.channelId,
    )
  )
    return { status: "unavailable" } as const;
  return {
    status: "ready" as const,
    page,
    anchorId,
    ...(focusedReply && { focusedReply }),
  };
}
