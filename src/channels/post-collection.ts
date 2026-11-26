import type { accountPostCollections } from "../mattermost/account-post-collections.ts";
import { mayKeepCache, workspaceFailure } from "./workspace-data.ts";

type Account = ReturnType<typeof accountPostCollections>;
type SavedScope = Parameters<Account["readSavedPosts"]>[0];
type Source = { kind: "pins"; channelId: string } | SavedScope;
type Collection = Awaited<ReturnType<Account["readPinnedChannelPosts"]>>;
type State = {
  status:
    | "idle"
    | "loading"
    | "refreshing"
    | "ready"
    | "closed"
    | ReturnType<typeof workspaceFailure>;
  value: Collection | null;
};

export function openPostCollection(account: Account, source: Source) {
  const scope = { ...source };
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  let state: State = { status: "idle", value: null };
  let pending: Promise<void> | undefined;

  function publish(next: State) {
    state = next;
    for (const listener of listeners) listener();
  }

  async function read() {
    const { signal } = lifetime;
    if (signal.aborted) return;
    let next: State;
    try {
      const value =
        scope.kind === "pins"
          ? await account.readPinnedChannelPosts(scope.channelId, signal)
          : await account.readSavedPosts(scope, 0, signal);
      next = { status: "ready", value };
    } catch (error) {
      const status = workspaceFailure(error, "network");
      next = { status, value: mayKeepCache(status) ? state.value : null };
    }
    if (!signal.aborted) {
      pending = undefined;
      publish(next);
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      if (!lifetime.signal.aborted) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh() {
      if (lifetime.signal.aborted) return Promise.resolve();
      if (pending) return pending;
      const request = Promise.resolve().then(read);
      pending = request;
      publish({
        status: state.value ? "refreshing" : "loading",
        value: state.value,
      });
      return request;
    },
    close() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      pending = undefined;
      publish({ status: "closed", value: null });
      listeners.clear();
    },
  };
}
