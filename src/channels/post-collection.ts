import { ResponseError } from "../../vendor/mattermost/index.js";
import type { accountPostCollections } from "../mattermost/account-post-collections.ts";
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
  let state: ReadState & { removing: readonly string[] } = {
    status: "idle",
    value: null,
    removing: [],
  };
  let requests = new AbortController();
  let pending: { result: Promise<void>; removed: Set<string> } | undefined;

  function publish(next: ReadState) {
    state = { ...next, removing: [...removals.keys()] };
    for (const listener of listeners) listener();
  }

  function cancelRequests() {
    requests.abort();
    requests = new AbortController();
    pending = undefined;
    removals.clear();
  }

  async function read(signal: AbortSignal, removed: Set<string>) {
    if (signal.aborted) return;
    let next: ReadState;
    try {
      const value =
        scope.kind === "pins"
          ? await account.readPinnedChannelPosts(scope.channelId, signal)
          : await account.readSavedPosts(scope, 0, signal);
      if (signal.aborted) return;
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
      if (!mayKeepCache(status)) cancelRequests();
    }
    pending = undefined;
    publish(next);
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
    close() {
      if (state.status === "closed") return;
      cancelRequests();
      publish({ status: "closed", value: null });
      listeners.clear();
    },
  };
}
