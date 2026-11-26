import type { searchChannelDirectory } from "../mattermost/channel-directory-page.ts";
import { workspaceFailure } from "./workspace-data.ts";

type Rows = Awaited<ReturnType<typeof searchChannelDirectory>>;
type Account = {
  searchChannelDirectory(
    teamId: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<Rows>;
};
type State = {
  query: string;
  status:
    | "idle"
    | "loading"
    | "ready"
    | "closed"
    | ReturnType<typeof workspaceFailure>;
  items: readonly Rows[number][];
};

const inputDelay = 100;

export function openDirectorySearch(account: Account, teamId: string) {
  const listeners = new Set<() => void>();
  let state: State = { query: "", status: "idle", items: [] };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | undefined;

  function publish(next: State) {
    state = next;
    for (const listener of listeners) listener();
  }

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
    active?.abort();
    active = undefined;
  }

  async function read(query: string, controller: AbortController) {
    const { signal } = controller;
    let next: State;
    try {
      signal.throwIfAborted();
      const items = await account.searchChannelDirectory(teamId, query, signal);
      next = { query, status: "ready", items };
    } catch (error) {
      if (signal.aborted) return;
      next = { query, status: workspaceFailure(error, "network"), items: [] };
    }
    if (!signal.aborted) {
      active = undefined;
      publish(next);
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      if (state.status !== "closed") listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setQuery(text: string) {
      const query = text.trim();
      if (state.status === "closed" || state.query === query) return;
      cancel();
      if (!query) {
        publish({ query, status: "idle", items: [] });
        return;
      }
      const controller = new AbortController();
      active = controller;
      timer = setTimeout(() => {
        timer = undefined;
        void read(query, controller);
      }, inputDelay);
      publish({ query, status: "loading", items: [] });
    },
    retry() {
      if (state.status !== "network" && state.status !== "storage") return;
      const query = state.query;
      const controller = new AbortController();
      active = controller;
      publish({ query, status: "loading", items: [] });
      return read(query, controller);
    },
    close() {
      if (state.status === "closed") return;
      cancel();
      publish({ query: "", status: "closed", items: [] });
      listeners.clear();
    },
  };
}
