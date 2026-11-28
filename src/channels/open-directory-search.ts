import type { searchChannelDirectory } from "../mattermost/channel-directory-page.ts";
import { mayKeepCache, workspaceFailure } from "./workspace-data.ts";

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
    | "refreshing"
    | "ready"
    | "closed"
    | ReturnType<typeof workspaceFailure>;
  items: readonly Rows[number][];
  hasResponse: boolean;
};

const inputDelay = 100;

export function openDirectorySearch(account: Account, teamId: string) {
  const listeners = new Set<() => void>();
  let state: State = {
    query: "",
    status: "idle",
    items: [],
    hasResponse: false,
  };
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

  async function read(query: string, { signal }: AbortController) {
    let next: State;
    try {
      signal.throwIfAborted();
      const items = await account.searchChannelDirectory(teamId, query, signal);
      next = { query, status: "ready", items, hasResponse: true };
    } catch (error) {
      if (signal.aborted) return;
      const status = workspaceFailure(error, "network");
      next = mayKeepCache(status)
        ? { ...state, status }
        : { query, status, items: [], hasResponse: false };
    }
    if (!signal.aborted) {
      active = undefined;
      publish(next);
    }
  }

  function start(delay: boolean) {
    if (active) return;
    const query = state.query;
    const controller = new AbortController();
    active = controller;
    if (delay)
      timer = setTimeout(() => {
        timer = undefined;
        void read(query, controller);
      }, inputDelay);
    publish({ ...state, status: state.hasResponse ? "refreshing" : "loading" });
    if (!delay) return read(query, controller);
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      if (state.status !== "closed") listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setQuery(text: string) {
      const query = text.trim();
      if (state.status === "closed" || state.query === query) return;
      cancel();
      state = { query, status: "idle", items: [], hasResponse: false };
      if (query) start(true);
      else publish(state);
    },
    resume() {
      if (
        state.query &&
        (state.status === "idle" ||
          state.status === "network" ||
          state.status === "storage" ||
          state.hasResponse)
      )
        return start(false);
    },
    retry() {
      if (state.status === "network" || state.status === "storage")
        return start(false);
    },
    pause() {
      if (!active) return;
      cancel();
      publish({ ...state, status: state.hasResponse ? "ready" : "idle" });
    },
    close() {
      if (state.status === "closed") return;
      cancel();
      publish({ query: "", status: "closed", items: [], hasResponse: false });
      listeners.clear();
    },
  };
}
