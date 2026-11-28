import { ResponseError } from "../../vendor/mattermost/index.js";
import type { ChannelEventNotice } from "../mattermost/account-channel-events.ts";
import type {
  LiveHistoryAccess,
  LocalChannelWindow,
} from "../mattermost/local-history.ts";
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
  onHistoryAccess?: (access: LiveHistoryAccess) => void;
};
type Account = Pick<
  WorkspaceConnection,
  | "refreshChannelHistory"
  | "applyChannelPostEvents"
  | "readSavedPost"
  | "readThreadPage"
>;

async function isUnavailable(error: unknown, signal: AbortSignal) {
  signal.throwIfAborted();
  if (
    !(error instanceof ResponseError) ||
    ![403, 404].includes(error.response.status)
  )
    return false;
  await error.response.body?.cancel().catch(() => {});
  signal.throwIfAborted();
  return true;
}

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
    const result = await retryPostObservation(async () => {
      const read = await account.refreshChannelHistory(query, signal);
      signal.throwIfAborted();
      if (read.kind === "superseded") throw new PostObservationSuperseded();
      return read;
    }, signal);
    if (result.firstInaccessiblePostTime)
      scope.onHistoryAccess?.({
        kind: "cutoff",
        time: result.firstInaccessiblePostTime,
      });
    return result;
  }
  const query = { channelId, collapsedThreads };
  let channelProof: Promise<boolean> | undefined;
  function readLatest() {
    // A page without an anchor tests channel content access independently of a post.
    return refresh({ ...query, kind: "latest" }).then(
      () => true,
      async (error) => {
        if (await isUnavailable(error, signal)) return false;
        throw error;
      },
    );
  }
  function confirmChannelRead() {
    channelProof ??= readLatest();
    return channelProof;
  }
  function hide(postId: string) {
    scope.onHistoryAccess?.({ kind: "unavailable", postId });
  }
  signal.throwIfAborted();
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
    if (!(await readLatest())) return "forbidden";
  }
  if (notice.kind === "reconcile") {
    const rows = page?.posts.filter((post) => visible.has(post.id)) ?? [];
    if (rows.length) {
      try {
        await refresh({
          ...query,
          kind: "since",
          since: Math.max(1, Math.min(...rows.map((row) => row.updateAt)) - 1),
        });
      } catch (error) {
        if (await isUnavailable(error, signal)) return "forbidden";
        throw error;
      }
    }
  }
  for (const postId of roots) {
    try {
      const result = await refresh({
        ...query,
        kind: "focused",
        postId,
        perPage: 1,
      });
      if (result.kind === "inaccessible" && thread?.rootId === postId)
        thread.unavailable("limited", result.firstInaccessiblePostTime);
    } catch (error) {
      if (!(await isUnavailable(error, signal))) throw error;
      // Focused reads combine the thread and its neighbors. Check each scope
      // separately before withholding the channel or the exact root.
      if (!(await confirmChannelRead())) return "forbidden";
      let exact: Awaited<ReturnType<Account["readThreadPage"]>>;
      try {
        exact = await retryPostObservation(
          () =>
            account.readThreadPage(
              { ...query, rootId: postId, direction: "up", perPage: 1 },
              signal,
            ),
          signal,
        );
        signal.throwIfAborted();
      } catch (cause) {
        if (!(await isUnavailable(cause, signal))) throw cause;
        hide(postId);
        if (thread?.rootId === postId) thread.unavailable("forbidden");
        continue;
      }
      if (exact.kind === "page") throw error;
      scope.onHistoryAccess?.({
        kind: "cutoff",
        time: exact.firstInaccessiblePostTime,
      });
      if (thread?.rootId === postId)
        thread.unavailable("limited", exact.firstInaccessiblePostTime);
    }
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
    for (const id of applied.refused ?? []) hide(id);
    if (applied.refused?.length && !(await confirmChannelRead()))
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
