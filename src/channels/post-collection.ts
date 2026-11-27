import { ResponseError } from "../../vendor/mattermost/index.js";
import {
  type accountPostCollections,
  savedPageSize,
} from "../mattermost/account-post-collections.ts";
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
};
type Removal =
  | "removed"
  | "unavailable"
  | "refused"
  | "network"
  | "storage"
  | "unauthorized"
  | "session";

export function openPostCollection(account: Account, source: Source) {
  const scope = { ...source };
  const listeners = new Set<() => void>();
  const removals = new Map<string, Promise<Removal>>();
  type Continuation = "none" | "available" | "loading" | "network" | "storage";
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
  let pending: { result: Promise<void>; removed: Set<string> } | undefined;

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
  }

  async function read(signal: AbortSignal, removed: Set<string>) {
    if (signal.aborted) return;
    let next: ReadState;
    try {
      const [value, limit] =
        scope.kind === "pins"
          ? ([
              await account.readPinnedChannelPosts(scope.channelId, signal),
              0,
            ] as const)
          : await Promise.all([
              account.readSavedPosts(scope, 0, signal),
              account.readSavedPostUpperBound(signal),
            ]);
      if (signal.aborted) return;
      // Concurrent removals might already be absent from the preference response.
      // Keep its upper bound and overlap their raw positions on the next read.
      cursor =
        scope.kind === "pins"
          ? undefined
          : { offset: Math.max(0, savedPageSize - removed.size), limit };
      // A write confirmed after this read started takes precedence over its snapshot.
      next = {
        status: "ready",
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
        cursor = undefined;
        cancelRequests();
      }
    }
    pending = undefined;
    publish(next);
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
    if (cursor && state.value?.items.some((row) => row.id === postId)) {
      cancelNextPage();
      cursor.offset = Math.max(0, cursor.offset - 1);
      cursor.limit = Math.max(0, cursor.limit - 1);
    }
    pending?.removed.add(postId);
    const value = state.value;
    publish({
      status: state.status,
      value: value && {
        ...value,
        items: value.items.filter((row) => row.id !== postId),
      },
    });
    return "removed";
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      if (state.status !== "closed") listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh() {
      if (state.status === "closed") return Promise.resolve();
      if (pending) return pending.result;
      cancelNextPage();
      const { signal } = requests;
      const removed = new Set<string>();
      const result = Promise.resolve().then(() => read(signal, removed));
      pending = { result, removed };
      publish({
        status: state.value ? "refreshing" : "loading",
        value: state.value,
      });
      return result;
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
      cancelRequests();
      publish({ status: state.value ? "ready" : "idle", value: state.value });
    },
    close() {
      if (state.status === "closed") return;
      cursor = undefined;
      cancelRequests();
      publish({ status: "closed", value: null });
      listeners.clear();
    },
  };
}
