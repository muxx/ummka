import type {
  DirectoryPageQuery,
  readChannelDirectoryPage,
} from "../mattermost/channel-directory-page.ts";
import { mayKeepCache, workspaceFailure } from "./workspace-data.ts";

type DirectoryPage = Awaited<ReturnType<typeof readChannelDirectoryPage>>;
type Row = DirectoryPage["items"][number];
type Account = {
  readChannelDirectoryPage(
    query: DirectoryPageQuery,
    signal?: AbortSignal,
  ): Promise<DirectoryPage>;
};
type Status =
  | "idle"
  | "loading"
  | "ready"
  | "closed"
  | ReturnType<typeof workspaceFailure>;
type State = {
  status: Status;
  items: readonly Row[];
  hasMore: boolean;
};

export function availableDirectoryChannels(
  items: readonly Row[],
  joined: ReadonlySet<string>,
) {
  return items.filter(
    (row) => row.kind === "O" && row.deleteAt === 0 && !joined.has(row.id),
  );
}

export function openChannelDirectoryList(
  account: Account,
  teamId: string,
  kind: DirectoryPageQuery["kind"],
) {
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  const rowsById = new Map<string, Row>();
  let state: State = { status: "idle", items: [], hasMore: true };
  let page = 0;
  let pending: Promise<void> | undefined;

  function publish(next: State) {
    state = next;
    for (const listener of listeners) listener();
  }

  async function read() {
    const { signal } = lifetime;
    let next: State;
    try {
      signal.throwIfAborted();
      const answer = await account.readChannelDirectoryPage(
        { teamId, kind, page },
        signal,
      );
      if (signal.aborted) return;
      // A change on the server can move an already delivered channel into the next page.
      for (const row of answer.items) rowsById.set(row.id, row);
      page++;
      next = {
        status: "ready",
        items: [...rowsById.values()],
        hasMore: answer.hasMore,
      };
    } catch (error) {
      if (signal.aborted) return;
      const status = workspaceFailure(error, "network");
      const retain = mayKeepCache(status);
      if (!retain) rowsById.clear();
      next = { status, items: retain ? state.items : [], hasMore: retain };
    }
    pending = undefined;
    publish(next);
  }

  function load() {
    if (pending) return pending;
    // Assign before publishing; a synchronous observer can request the same page.
    const request = Promise.resolve().then(read);
    pending = request;
    publish({ ...state, status: "loading" });
    return request;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      if (!lifetime.signal.aborted) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    more() {
      if (state.status === "loading") return pending;
      return (state.status === "idle" || state.status === "ready") &&
        state.hasMore
        ? load()
        : undefined;
    },
    retry() {
      return state.status === "network" || state.status === "storage"
        ? load()
        : pending;
    },
    close() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      rowsById.clear();
      pending = undefined;
      publish({ status: "closed", items: [], hasMore: false });
      listeners.clear();
    },
  };
}
