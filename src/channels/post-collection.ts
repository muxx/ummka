import { ResponseError } from "../../vendor/mattermost/index.js";
import {
  type accountPostCollections,
  savedPageSize,
} from "../mattermost/account-post-collections.ts";
import { isMattermostId } from "../mattermost/model-fields.ts";
import type { accountCollectionActions } from "../mattermost/post-collection-actions.ts";
import { mayKeepCache, workspaceFailure } from "./workspace-data.ts";

type Account = ReturnType<typeof accountPostCollections> &
  ReturnType<typeof accountCollectionActions>;
type SavedScope = Parameters<Account["readSavedPosts"]>[0];
type Source = { kind: "pins"; channelId: string } | SavedScope;
type Collection = Awaited<ReturnType<Account["readPinnedChannelPosts"]>>;
type ReadState = {
  status:
    | "idle"
    | "loading"
    | "refreshing"
    | "ready"
    | "closed"
    | ReturnType<typeof workspaceFailure>;
  value: Collection | null;
  returnedPost?: { id: string; saved: boolean | undefined };
};
type Removal =
  | "removed"
  | "unavailable"
  | "refused"
  | "network"
  | "storage"
  | "unauthorized"
  | "session";
type Continuation = "none" | "available" | "loading" | "network" | "storage";
type Refresh = { result: Promise<void>; writes?: Map<string, boolean> };

export function newestCollectionItems(items: Collection["items"]) {
  return [...items].sort((a, b) => (b.createAt ?? 0) - (a.createAt ?? 0));
}

export function returnedPostRemoved(
  state: ReadState & { continuation: Continuation },
  id: string,
  index: number | undefined,
) {
  return (
    index !== undefined &&
    state.status === "ready" &&
    state.returnedPost?.id === id &&
    state.returnedPost.saved === false &&
    (state.continuation === "none" || (state.value?.items.length ?? 0) > index)
  );
}

export function openPostCollection(account: Account, source: Source) {
  const scope = { ...source };
  const listeners = new Set<() => void>();
  const removals = new Map<string, Promise<Removal>>();
  const savesAwaitingRead = new Set<string>();
  let cursor: { offset: number; limit: number } | undefined;
  let nextPage:
    | { controller: AbortController; result: Promise<void> }
    | undefined;
  let pageIssue: "network" | "storage" | undefined;
  let state: ReadState & {
    removing: readonly string[];
    continuation: Continuation;
  } = {
    continuation: "none",
    status: "idle",
    value: null,
    removing: [],
  };
  let requests = new AbortController();
  let pending: Refresh | undefined;
  let displayed = false;
  let suspended = true;

  function publish(next: ReadState) {
    const continuation = nextPage
      ? "loading"
      : cursor && cursor.offset < cursor.limit
        ? (pageIssue ?? "available")
        : "none";
    state = { ...next, removing: [...removals.keys()], continuation };
    for (const listener of listeners) listener();
  }

  function cancelNextPage() {
    nextPage?.controller.abort();
    nextPage = undefined;
    pageIssue = undefined;
  }

  function cancelRequests() {
    cancelNextPage();
    requests.abort();
    requests = new AbortController();
    pending = undefined;
    removals.clear();
    savesAwaitingRead.clear();
  }

  function applyRemoval(postId: string): ReadState | undefined {
    savesAwaitingRead.delete(postId);
    pending?.writes?.set(postId, false);
    const { value, returnedPost } = state;
    const visible = value?.items.some((row) => row.id === postId);
    const returned =
      returnedPost?.id === postId && returnedPost.saved !== false;
    const shifted = cursor && (visible || cursor.offset < cursor.limit);
    if (cursor && shifted) {
      // Even a hidden row may have shifted the raw server offset.
      cancelNextPage();
      cursor.offset = Math.max(0, cursor.offset - 1);
      if (visible) cursor.limit = Math.max(0, cursor.limit - 1);
    }
    if (visible || returned || shifted)
      return {
        status: state.status,
        returnedPost: returned ? { id: postId, saved: false } : returnedPost,
        value:
          visible && value
            ? {
                ...value,
                items: value.items.filter((row) => row.id !== postId),
              }
            : value,
      };
  }

  function refreshVisible(snapshot: ReadState = state) {
    if (displayed && snapshot.status === "ready" && savesAwaitingRead.size) {
      const depth = cursor ? Math.min(cursor.offset, cursor.limit) : 0;
      return startRead(
        snapshot.returnedPost?.id,
        snapshot,
        depth + savesAwaitingRead.size,
      );
    }
  }

  const stopWrites =
    scope.kind === "pins"
      ? undefined
      : account.subscribeToSavedPostWrites((postId, saved) => {
          if (!saved) {
            const next = applyRemoval(postId);
            if (next) publish(next);
            return;
          }
          if (pending) {
            pending.writes?.set(postId, true);
            return;
          }
          const returnedPost = state.returnedPost;
          const next =
            returnedPost?.id === postId && !returnedPost.saved
              ? { ...state, returnedPost: { id: postId, saved: true } }
              : undefined;
          if (
            !suspended &&
            state.value &&
            !state.value.items.some((row) => row.id === postId)
          )
            savesAwaitingRead.add(postId);
          if (!refreshVisible(next) && next) publish(next);
        });

  async function read(
    signal: AbortSignal,
    returnedPostId: string | undefined,
    depth: number,
  ): Promise<void> {
    if (signal.aborted || !pending) return;
    const writes = new Map<string, boolean>();
    pending.writes = writes;
    savesAwaitingRead.clear();
    let next: ReadState;
    let readCursor = cursor;
    try {
      if (
        scope.kind !== "pins" &&
        returnedPostId !== undefined &&
        !isMattermostId(returnedPostId)
      )
        throw new TypeError("Invalid Mattermost saved post ID.");
      const [initial, membership] =
        scope.kind === "pins"
          ? ([
              await account.readPinnedChannelPosts(scope.channelId, signal),
              undefined,
            ] as const)
          : await Promise.all([
              account.readSavedPosts(scope, 0, signal),
              account.readSavedPostPreferences(signal),
            ]);
      if (signal.aborted) return;
      let value = initial;
      let offset = savedPageSize;
      let overlapped = 0;
      function removalsDuringRead() {
        const ids = new Set<string>();
        for (const [postId, saved] of writes)
          if (
            !saved &&
            (scope.kind === "pins" ||
              account.getSavedPostState(postId) !== true)
          )
            ids.add(postId);
        return ids;
      }
      if (scope.kind !== "pins" && membership && depth > savedPageSize) {
        const limit = account.getSavedPostUpperBound();
        if (limit === undefined) throw "cancelled";
        const through = Math.min(limit, depth);
        const rows = new Map(value.items.map((row) => [row.id, row]));
        let cutoff = value.firstInaccessiblePostTime;
        while (offset < through) {
          const removals = removalsDuringRead().size;
          // Overlap the last page so a single insertion doesn't expand the window by 60.
          const from = Math.max(
            0,
            Math.min(
              offset - Math.max(0, removals - overlapped),
              through - savedPageSize,
            ),
          );
          const page = await account.readSavedPostsAtOffset(
            scope,
            from,
            signal,
          );
          if (signal.aborted) return;
          for (const row of page.items) rows.set(row.id, row);
          cutoff = Math.max(cutoff, page.firstInaccessiblePostTime);
          offset = from + savedPageSize;
          overlapped = removals;
        }
        value = {
          items: [...rows.values()],
          firstInaccessiblePostTime: cutoff,
        };
      }
      const removed = removalsDuringRead();
      for (const [postId, saved] of writes) {
        if (
          saved &&
          account.getSavedPostState(postId) !== false &&
          !value.items.some((row) => row.id === postId)
        )
          savesAwaitingRead.add(postId);
      }
      // Concurrent removals might already be absent from the preference response.
      // Keep its upper bound and overlap their raw positions on the next read.
      if (membership) {
        const limit = account.getSavedPostUpperBound();
        if (limit === undefined) throw "cancelled";
        readCursor = {
          offset: Math.max(0, offset - Math.max(0, removed.size - overlapped)),
          limit,
        };
      }
      next = {
        status: "ready",
        ...(returnedPostId &&
          membership && {
            returnedPost: {
              id: returnedPostId,
              saved: account.getSavedPostState(returnedPostId),
            },
          }),
        value: removed.size
          ? {
              ...value,
              items: value.items.filter((row) => !removed.has(row.id)),
            }
          : value,
      };
    } catch (error) {
      if (signal.aborted) return;
      const status = workspaceFailure(error, "network");
      next = { status, value: mayKeepCache(status) ? state.value : null };
      if (!mayKeepCache(status)) {
        readCursor = undefined;
        cancelRequests();
      } else {
        readCursor = cursor;
      }
    }
    pending = undefined;
    const refresh = refreshVisible(next);
    if (refresh) return refresh;
    cursor = readCursor;
    publish(next);
  }

  function startRead(returnedPostId?: string, interim?: ReadState, depth = 0) {
    if (pending) return pending.result;
    cancelNextPage();
    const { signal } = requests;
    const result = Promise.resolve().then(() =>
      read(signal, returnedPostId, depth),
    );
    pending = { result };
    const value = state.value ?? interim?.value ?? null;
    publish({
      status: value ? "refreshing" : "loading",
      value,
      ...(interim?.returnedPost && { returnedPost: interim.returnedPost }),
    });
    return result;
  }

  async function append(
    scope: SavedScope,
    offset: number,
    signal: AbortSignal,
  ) {
    if (signal.aborted) return;
    try {
      const page = await account.readSavedPostsAtOffset(scope, offset, signal);
      if (signal.aborted || !cursor || !state.value) return;
      const seen = new Set(state.value.items.map((row) => row.id));
      const items = [
        ...state.value.items,
        ...page.items.filter((row) => !seen.has(row.id)),
      ];
      cursor.offset = offset + savedPageSize;
      nextPage = undefined;
      pageIssue = undefined;
      publish({
        status: "ready",
        returnedPost: state.returnedPost && {
          id: state.returnedPost.id,
          saved: account.getSavedPostState(state.returnedPost.id),
        },
        value: {
          items,
          firstInaccessiblePostTime: Math.max(
            state.value.firstInaccessiblePostTime,
            page.firstInaccessiblePostTime,
          ),
        },
      });
    } catch (error) {
      if (signal.aborted) return;
      const status = workspaceFailure(error, "network");
      nextPage = undefined;
      if (status === "network" || status === "storage") {
        pageIssue = status;
        publish(state);
      } else {
        cursor = undefined;
        cancelRequests();
        publish({ status, value: null });
      }
    }
  }

  async function remove(postId: string, signal: AbortSignal): Promise<Removal> {
    if (signal.aborted) return "unavailable";
    try {
      if (scope.kind === "pins")
        await account.setPostPinned(postId, false, signal);
      else await account.setPostSaved(postId, false, signal);
    } catch (error) {
      if (signal.aborted) return "unavailable";
      removals.delete(postId);
      const reason = workspaceFailure(error, "network");
      if (reason === "unauthorized" || reason === "session") {
        cursor = undefined;
        cancelRequests();
        publish({ status: reason, value: null });
        return reason;
      }
      publish(state);
      return error instanceof ResponseError || reason === "forbidden"
        ? "refused"
        : reason;
    }
    if (signal.aborted) return "unavailable";
    removals.delete(postId);
    publish(
      (scope.kind === "pins" ? applyRemoval(postId) : undefined) ?? state,
    );
    return "removed";
  }

  return {
    getSnapshot: () => state,
    setVisible(visible: boolean) {
      displayed = visible;
      void refreshVisible();
    },
    subscribe(listener: () => void) {
      if (state.status !== "closed") listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh(returnedPostId?: string) {
      if (state.status === "closed") return Promise.resolve();
      suspended = false;
      return startRead(returnedPostId);
    },
    loadMore() {
      if (nextPage) return nextPage.result;
      if (
        scope.kind === "pins" ||
        pending ||
        !cursor ||
        !state.value ||
        cursor.offset >= cursor.limit
      )
        return Promise.resolve();
      const controller = new AbortController();
      const offset = cursor.offset;
      const result = Promise.resolve().then(() =>
        append(scope, offset, controller.signal),
      );
      nextPage = { controller, result };
      publish(state);
      return result;
    },
    remove(postId: string): Promise<Removal> {
      const existing = removals.get(postId);
      if (existing) return existing;
      if (!state.value?.items.some((row) => row.id === postId))
        return Promise.resolve("unavailable");
      const { signal } = requests;
      const result = Promise.resolve().then(() => remove(postId, signal));
      removals.set(postId, result);
      publish(state);
      return result;
    },
    suspend() {
      if (state.status === "closed") return;
      displayed = false;
      suspended = true;
      cancelRequests();
      publish({ status: state.value ? "ready" : "idle", value: state.value });
    },
    close() {
      if (state.status === "closed") return;
      stopWrites?.();
      cursor = undefined;
      cancelRequests();
      publish({ status: "closed", value: null });
      listeners.clear();
    },
  };
}
