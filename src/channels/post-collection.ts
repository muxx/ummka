import { ResponseError } from "../../vendor/mattermost/index.js";
import {
  type accountPostCollections,
  savedPageSize,
} from "../mattermost/account-post-collections.ts";
import { isMattermostId } from "../mattermost/model-fields.ts";
import type { accountCollectionActions } from "../mattermost/post-collection-actions.ts";
import {
  type CollectionWindow,
  collectionWindow,
  collectionWindowPages,
  forgetPostChannel,
} from "./collection-window.ts";
import {
  collectionReadFailure,
  mayKeepCache,
  workspaceFailure,
} from "./workspace-data.ts";

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
    | ReturnType<typeof collectionReadFailure>;
  value: Collection | null;
  manualPage?: true;
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

function canRetainRows(status: ReturnType<typeof collectionReadFailure>) {
  return status === "unknown" || mayKeepCache(status);
}

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
  let cursor: { start: number; offset: number; limit: number } | undefined;
  let rowOffsets = new Map<string, number>();
  const deniedChannels = new Set<string>();
  let nextPage:
    | { controller: AbortController; result: Promise<void>; earlier: boolean }
    | undefined;
  let pageIssue:
    | { reason: "network" | "storage"; earlier: boolean }
    | undefined;
  let state: ReadState & {
    removing: readonly string[];
    continuation: Continuation;
    newer?: Continuation;
  } = {
    continuation: "none",
    status: "idle",
    value: null,
    removing: [],
  };
  let writeRequests = new AbortController();
  let readRequest: AbortController | undefined;
  let pending: Refresh | undefined;
  let displayed = false;
  let activeAnchor: (() => string | undefined) | undefined;
  let suspended = true;

  function publish(next: ReadState) {
    const boundary = (earlier: boolean): Continuation =>
      nextPage?.earlier === earlier
        ? "loading"
        : pageIssue?.earlier === earlier
          ? pageIssue.reason
          : "available";
    const continuation =
      cursor && cursor.offset < cursor.limit ? boundary(false) : "none";
    const newer = cursor && cursor.start > 0 ? boundary(true) : undefined;
    state = { ...next, removing: [...removals.keys()], continuation };
    if (newer) state.newer = newer;
    else delete state.newer;
    for (const listener of listeners) listener();
  }

  function cancelNextPage() {
    nextPage?.controller.abort();
    nextPage = undefined;
    pageIssue = undefined;
  }

  function cancelRequests() {
    cancelNextPage();
    readRequest?.abort();
    readRequest = undefined;
    writeRequests.abort();
    writeRequests = new AbortController();
    pending = undefined;
    removals.clear();
    savesAwaitingRead.clear();
  }

  function denyRead(status: ReturnType<typeof collectionReadFailure>) {
    cursor = undefined;
    rowOffsets.clear();
    cancelRequests();
    publish({ status, value: null });
  }

  function observeSavedAccess<T>(read: Promise<T>, signal: AbortSignal) {
    return read.catch((error: unknown) => {
      // The other GET may have already shown Retry while this one was in flight.
      if (!signal.aborted) {
        const status = collectionReadFailure(error);
        if (!canRetainRows(status)) denyRead(status);
      }
      throw error;
    });
  }

  function applyRemoval(postId: string): ReadState | undefined {
    savesAwaitingRead.delete(postId);
    rowOffsets.delete(postId);
    pending?.writes?.set(postId, false);
    const { value, returnedPost } = state;
    const visible = value?.items.some((row) => row.id === postId);
    const returned =
      returnedPost?.id === postId && returnedPost.saved !== false;
    const shifted = cursor && (visible || cursor.offset < cursor.limit);
    if (cursor && shifted) {
      // Even a hidden row may have shifted the raw server offset.
      cancelNextPage();
      cursor.offset = Math.max(cursor.start, cursor.offset - 1);
      if (visible) cursor.limit = Math.max(0, cursor.limit - 1);
    }
    if (visible || returned || shifted)
      return {
        status: state.status,
        ...(state.manualPage && { manualPage: true }),
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

  function refreshVisible(
    snapshot: ReadState = state,
    window?: CollectionWindow,
  ) {
    if (displayed && snapshot.status === "ready" && savesAwaitingRead.size) {
      const depth = cursor ? Math.min(cursor.offset, cursor.limit) : 0;
      return window || (cursor && cursor.start > 0)
        ? startRead(
            undefined,
            snapshot,
            0,
            savedWindow(activeAnchor?.()) ?? window,
          )
        : startRead(
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

  function savedWindow(anchor?: string) {
    if (!cursor) return;
    const through = Math.max(
      cursor.start + 1,
      Math.min(cursor.offset, cursor.limit),
    );
    return collectionWindow(
      cursor.start,
      through,
      anchor ? rowOffsets.get(anchor) : undefined,
      savedPageSize,
    );
  }

  async function read(
    signal: AbortSignal,
    returnedPostId: string | undefined,
    depth: number,
    window: CollectionWindow | undefined,
  ): Promise<void> {
    if (signal.aborted || !pending) return;
    const writes = new Map<string, boolean>();
    pending.writes = writes;
    savesAwaitingRead.clear();
    let next: ReadState;
    let readCursor = cursor;
    let positions = rowOffsets;
    let start = window?.start ?? 0;
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
              observeSavedAccess(
                start
                  ? account.readSavedPostsAtOffset(scope, start, signal)
                  : account.readSavedPosts(scope, 0, signal),
                signal,
              ),
              observeSavedAccess(
                account.readSavedPostPreferences(signal),
                signal,
              ),
            ]);
      if (signal.aborted) return;
      let value = initial;
      let offset = start + savedPageSize;
      let overlapped = 0;
      positions = new Map(value.items.map(({ id }) => [id, start]));
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
      if (
        scope.kind !== "pins" &&
        membership &&
        (window || depth > savedPageSize)
      ) {
        const limit = account.getSavedPostUpperBound();
        if (limit === undefined) throw "cancelled";
        const through = Math.min(limit, window?.through ?? depth);
        const rows = new Map(value.items.map((row) => [row.id, row]));
        let cutoff = value.firstInaccessiblePostTime;
        for (
          let pageIndex = 1;
          offset < through && (!window || pageIndex < collectionWindowPages);
          pageIndex++
        ) {
          const removals = removalsDuringRead().size;
          // Overlap the last page so a single insertion doesn't expand the window by 60.
          const from = Math.max(
            start,
            Math.min(
              offset - Math.max(0, removals - overlapped),
              window ? offset : through - savedPageSize,
            ),
          );
          const page = await account.readSavedPostsAtOffset(
            scope,
            from,
            signal,
          );
          if (signal.aborted) return;
          for (const row of page.items) {
            rows.set(row.id, row);
            positions.set(row.id, from);
          }
          cutoff = Math.max(cutoff, page.firstInaccessiblePostTime);
          offset = from + savedPageSize;
          overlapped = removals;
        }
        value = {
          items: forgetPostChannel([...rows.values()], deniedChannels),
          firstInaccessiblePostTime: cutoff,
        };
        // A short or hidden raw page does not prove the end. Only the flags
        // bound can invalidate this interval and require a read from the head.
        if (start > 0 && start >= limit) {
          cursor = undefined;
          rowOffsets.clear();
          publish({ status: "loading", value: null });
          value = await account.readSavedPosts(scope, 0, signal);
          signal.throwIfAborted();
          start = 0;
          offset = savedPageSize;
          overlapped = 0;
          positions = new Map(value.items.map(({ id }) => [id, 0]));
        }
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
          start,
          offset: Math.max(
            start,
            offset - Math.max(0, removed.size - overlapped),
          ),
          limit,
        };
      }
      next = {
        status: "ready",
        ...(window && { manualPage: true }),
        ...(returnedPostId &&
          membership && {
            returnedPost: {
              id: returnedPostId,
              saved: account.getSavedPostState(returnedPostId),
            },
          }),
        value:
          removed.size || deniedChannels.size
            ? {
                ...value,
                items: forgetPostChannel(
                  value.items.filter((row) => !removed.has(row.id)),
                  deniedChannels,
                ),
              }
            : value,
      };
    } catch (error) {
      if (signal.aborted) return;
      const status = collectionReadFailure(error);
      if (!canRetainRows(status)) return denyRead(status);
      next = {
        status,
        value: state.value,
        ...(state.manualPage && { manualPage: true }),
      };
      readCursor = cursor;
    }
    pending = undefined;
    const refresh = refreshVisible(next, window);
    if (refresh) return refresh;
    cursor = readCursor;
    if (next.status === "ready") rowOffsets = positions;
    publish(next);
  }

  function startRead(
    returnedPostId?: string,
    interim?: ReadState,
    depth = 0,
    window?: CollectionWindow,
  ) {
    if (pending) return pending.result;
    cancelNextPage();
    readRequest?.abort();
    readRequest = new AbortController();
    const { signal } = readRequest;
    const result = Promise.resolve().then(() =>
      read(signal, returnedPostId, depth, window),
    );
    pending = { result };
    const value = state.value ?? interim?.value ?? null;
    publish({
      status: value ? "refreshing" : "loading",
      value,
      ...(state.manualPage && { manualPage: true }),
      ...(interim?.returnedPost && { returnedPost: interim.returnedPost }),
    });
    return result;
  }

  async function append(
    scope: SavedScope,
    offset: number,
    signal: AbortSignal,
    earlier: boolean,
  ) {
    if (signal.aborted) return;
    try {
      const page = await account.readSavedPostsAtOffset(scope, offset, signal);
      if (signal.aborted || !cursor || !state.value) return;
      const rows = forgetPostChannel(page.items, deniedChannels);
      const updated = new Map(rows.map((row) => [row.id, row]));
      const existing = state.value.items.map(
        (row) => updated.get(row.id) ?? row,
      );
      for (const { id } of existing) updated.delete(id);
      const fresh = [...updated.values()];
      for (const { id } of rows) rowOffsets.set(id, offset);
      const items = earlier ? [...fresh, ...existing] : [...existing, ...fresh];
      if (earlier) cursor.start = offset;
      else cursor.offset = offset + savedPageSize;
      nextPage = undefined;
      pageIssue = undefined;
      publish({
        ...state,
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
        pageIssue = { reason: status, earlier };
        publish(state);
      } else {
        denyRead(status);
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

  function loadPage(earlier: boolean) {
    if (nextPage) return nextPage.result;
    if (
      scope.kind === "pins" ||
      pending ||
      !cursor ||
      !state.value ||
      (earlier ? cursor.start === 0 : cursor.offset >= cursor.limit)
    )
      return Promise.resolve();
    const controller = new AbortController();
    const offset = earlier
      ? Math.max(0, cursor.start - savedPageSize)
      : cursor.offset;
    const result = Promise.resolve().then(() =>
      append(scope, offset, controller.signal, earlier),
    );
    nextPage = { controller, result, earlier };
    publish(state);
    return result;
  }

  return {
    getSnapshot: () => state,
    setVisible(visible: boolean, anchor?: () => string | undefined) {
      displayed = visible;
      activeAnchor = visible ? anchor : undefined;
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
    revalidate(anchor?: string) {
      if (state.status === "closed") return Promise.resolve();
      suspended = false;
      return startRead(undefined, undefined, 0, savedWindow(anchor));
    },
    retainReading(anchor?: string) {
      const window = savedWindow(anchor);
      if (!window || !cursor || !state.value || !anchor) return;
      const { start, through } = window;
      const { value } = state;
      const items = value.items.filter(({ id }) => {
        const offset = rowOffsets.get(id);
        return offset !== undefined && offset >= start && offset < through;
      });
      cursor.start = start;
      cursor.offset = Math.min(cursor.offset, through);
      rowOffsets = new Map(
        items.map(({ id }) => [id, rowOffsets.get(id) ?? start]),
      );
      if (items.length === value.items.length) publish(state);
      else publish({ ...state, value: { ...value, items } });
    },
    loadMore: () => loadPage(false),
    loadNewer: () => loadPage(true),
    setChannelDenied(channelId: string, denied: boolean) {
      if (!denied) {
        deniedChannels.delete(channelId);
        return;
      }
      deniedChannels.add(channelId);
      if (!state.value) return;
      const items = forgetPostChannel(state.value.items, deniedChannels);
      if (items.length === state.value.items.length) return;
      for (const row of state.value.items)
        if (row.channelId === channelId) rowOffsets.delete(row.id);
      publish({ ...state, value: { ...state.value, items } });
    },
    remove(postId: string): Promise<Removal> {
      const existing = removals.get(postId);
      if (existing) return existing;
      if (!state.value?.items.some((row) => row.id === postId))
        return Promise.resolve("unavailable");
      const { signal } = writeRequests;
      const result = Promise.resolve().then(() => remove(postId, signal));
      removals.set(postId, result);
      publish(state);
      return result;
    },
    suspend() {
      if (state.status === "closed") return;
      displayed = false;
      activeAnchor = undefined;
      suspended = true;
      cancelRequests();
      publish({
        status: state.value ? "ready" : "idle",
        value: state.value,
        ...(state.manualPage && { manualPage: true }),
      });
    },
    close() {
      if (state.status === "closed") return;
      stopWrites?.();
      activeAnchor = undefined;
      cursor = undefined;
      rowOffsets.clear();
      deniedChannels.clear();
      cancelRequests();
      publish({ status: "closed", value: null });
      listeners.clear();
    },
  };
}
