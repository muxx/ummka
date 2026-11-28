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
type Operation = "page" | "refresh";
type State = {
  status:
    | "idle"
    | "loading"
    | "refreshing"
    | "ready"
    | "closed"
    | ReturnType<typeof workspaceFailure>;
  items: readonly Row[];
  hasResponse: boolean;
  hasMore: boolean;
  failed?: Operation;
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
  const listeners = new Set<() => void>();
  let state: State = {
    status: "idle",
    items: [],
    hasResponse: false,
    hasMore: true,
  };
  let pages = 0;
  let pending:
    | { controller: AbortController; result: Promise<void> }
    | undefined;

  function publish(next: State) {
    state = next;
    for (const listener of listeners) listener();
  }

  async function read(operation: Operation, signal: AbortSignal) {
    const refresh = operation === "refresh";
    const items = new Map(
      refresh ? [] : state.items.map((row) => [row.id, row]),
    );
    let page = refresh ? 0 : pages;
    const until = refresh ? pages : pages + 1;
    let hasMore = true;
    let next: State;
    try {
      while (hasMore && page < until) {
        signal.throwIfAborted();
        const answer = await account.readChannelDirectoryPage(
          { teamId, kind, page },
          signal,
        );
        if (signal.aborted) return;
        // An overlap updates the earlier row in place. Refresh publishes only
        // when the whole confirmed range has been read again.
        for (const row of answer.items) items.set(row.id, row);
        hasMore = answer.hasMore;
        page++;
      }
      pages = page;
      next = {
        status: "ready",
        items: [...items.values()],
        hasResponse: true,
        hasMore,
      };
    } catch (error) {
      if (signal.aborted) return;
      const status = workspaceFailure(error, "network");
      if (mayKeepCache(status)) next = { ...state, status, failed: operation };
      else {
        pages = 0;
        next = { status, items: [], hasResponse: false, hasMore: false };
      }
    }
    pending = undefined;
    publish(next);
  }

  function start(operation: Operation) {
    if (pending) return pending.result;
    const controller = new AbortController();
    const result = Promise.resolve().then(() =>
      read(operation, controller.signal),
    );
    pending = { controller, result };
    publish({
      ...state,
      status: operation === "refresh" ? "refreshing" : "loading",
      failed: undefined,
    });
    return result;
  }

  function cancel() {
    pending?.controller.abort();
    pending = undefined;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      if (state.status !== "closed") listeners.add(listener);
      return () => listeners.delete(listener);
    },
    more() {
      if (pending) return pending.result;
      return (state.status === "idle" || state.status === "ready") &&
        state.hasMore
        ? start("page")
        : undefined;
    },
    refresh() {
      if (state.hasResponse) return start("refresh");
    },
    retry() {
      return state.failed ? start(state.failed) : pending?.result;
    },
    pause() {
      if (!pending) return;
      cancel();
      publish({ ...state, status: state.hasResponse ? "ready" : "idle" });
    },
    close() {
      if (state.status === "closed") return;
      cancel();
      pages = 0;
      publish({
        status: "closed",
        items: [],
        hasResponse: false,
        hasMore: false,
      });
      listeners.clear();
    },
  };
}
