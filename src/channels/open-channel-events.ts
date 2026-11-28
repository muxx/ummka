import { ResponseError } from "../../vendor/mattermost/index.js";
import type { ChannelEventNotice } from "../mattermost/account-channel-events.ts";
import type { LocalChannelWindow } from "../mattermost/local-history.ts";
import {
  PostObservationSuperseded,
  retryPostObservation,
} from "../mattermost/message-anchors.ts";
import type { openThreadReplyWindow } from "./thread-reply-window.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

type Scope = {
  channelId: string;
  collapsedThreads: boolean;
  page: LocalChannelWindow | null;
  visibleIds: readonly string[];
  thread: ReturnType<typeof openThreadReplyWindow> | null;
  threadOnly?: boolean;
  firstVisibleReply?: string;
};
type Account = Pick<
  WorkspaceConnection,
  "refreshChannelHistory" | "applyChannelPostEvents" | "readSavedPost"
>;

export async function applyOpenChannelEvents(
  account: Account,
  scope: Scope,
  notice: ChannelEventNotice,
  signal: AbortSignal,
) {
  const { channelId, collapsedThreads, page, thread } = scope;
  const addresses =
    notice.kind === "posts"
      ? notice.changes.filter(
          (row) =>
            row.channelId === channelId &&
            (!scope.threadOnly ||
              row.postId === thread?.rootId ||
              row.rootId === thread?.rootId),
        )
      : [];
  if (notice.kind === "posts" && !addresses.length) return;
  const changes = new Map<string, (typeof addresses)[number]>();
  for (const row of addresses)
    if (changes.get(row.postId)?.kind !== "deleted")
      changes.set(row.postId, row);
  const visible = new Set(scope.visibleIds);
  const roots = new Set<string>();
  for (const row of changes.values()) {
    if (
      !scope.threadOnly &&
      collapsedThreads &&
      row.rootId &&
      row.kind !== "edited" &&
      (visible.has(row.rootId) ||
        scope.thread?.rootId === row.rootId ||
        page?.posts.some((post) => post.id === row.rootId)) &&
      changes.get(row.rootId)?.kind !== "deleted"
    )
      roots.add(row.rootId);
  }
  async function refresh(
    query: Parameters<Account["refreshChannelHistory"]>[0],
  ) {
    try {
      return await retryPostObservation(async () => {
        const result = await account.refreshChannelHistory(query, signal);
        signal.throwIfAborted();
        if (result.kind === "superseded") throw new PostObservationSuperseded();
        return result.kind;
      }, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (
        !(error instanceof ResponseError) ||
        ![403, 404].includes(error.response.status)
      )
        throw error;
      await error.response.body?.cancel().catch(() => {});
      return query.kind === "focused" ? "missingRoot" : "forbidden";
    }
  }
  signal.throwIfAborted();
  const query = { channelId, collapsedThreads };
  if (
    !scope.threadOnly &&
    (notice.kind === "reconcile" ||
      addresses.some(
        (row) =>
          row.kind === "created" &&
          changes.get(row.postId)?.kind !== "deleted" &&
          (!collapsedThreads || !row.rootId),
      ))
  ) {
    const result = await refresh({ ...query, kind: "latest" });
    if (result === "forbidden" || result === "inaccessible") return result;
  }
  if (notice.kind === "reconcile") {
    const rows = page?.posts.filter((post) => visible.has(post.id)) ?? [];
    if (rows.length) {
      const result = await refresh({
        ...query,
        kind: "since",
        since: Math.max(1, Math.min(...rows.map((row) => row.updateAt)) - 1),
      });
      if (result === "forbidden" || result === "inaccessible") return result;
    }
  }
  for (const postId of roots) {
    await refresh({ ...query, kind: "focused", postId, perPage: 1 });
  }
  const kept: typeof addresses = [];
  const inThread = thread?.getSnapshot();
  for (const row of changes.values()) {
    if (row.kind === "deleted") kept.push(row);
    if (row.kind !== "edited") continue;
    if (
      visible.has(row.postId) ||
      thread?.rootId === row.postId ||
      inThread?.replies.some((reply) => reply.id === row.postId) ||
      (await account.readSavedPost(channelId, row.postId))
    )
      kept.push(row);
    signal.throwIfAborted();
  }
  let applied: Awaited<ReturnType<Account["applyChannelPostEvents"]>> | null =
    null;
  try {
    if (kept.length) {
      applied = await retryPostObservation(async () => {
        const result = await account.applyChannelPostEvents(
          channelId,
          kept,
          signal,
        );
        signal.throwIfAborted();
        if (result.result.kind === "superseded")
          throw new PostObservationSuperseded();
        return result;
      }, signal);
    }
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof ResponseError && error.response.status === 403))
      throw error;
    await error.response.body?.cancel().catch(() => {});
    return "forbidden";
  }
  signal.throwIfAborted();
  if (
    thread &&
    (notice.kind === "reconcile" ||
      addresses.some(
        (row) => row.postId === thread.rootId || row.rootId === thread.rootId,
      ))
  )
    await thread.refreshEvents(
      notice.kind === "reconcile",
      addresses,
      applied?.changes ?? [],
      signal,
      scope.firstVisibleReply,
    );
}
