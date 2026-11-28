import type { openAccountRestConnection } from "../mattermost/native-rest.ts";
import { collectionWindow, forgetPostChannel } from "./collection-window.ts";
import { mayKeepCache, workspaceFailure } from "./workspace-data.ts";

type Account = Pick<
  Awaited<ReturnType<typeof openAccountRestConnection>>,
  "openRecentMentions"
>;
type Reader = Awaited<ReturnType<Account["openRecentMentions"]>>;
type Page = Awaited<ReturnType<Reader["readPage"]>>;
type Failure = ReturnType<typeof workspaceFailure>;

export function openMentionList(account: Account, archivedChannels: boolean) {
  const listeners = new Set<() => void>();
  const initial = {
    items: [] as Page["items"],
    nextPage: 0 as number | null,
    firstInaccessiblePostTime: 0,
    hasResponse: false,
  };
  let state: typeof initial & {
    newer?: "available" | "loading" | "network" | "storage";
    manualPage?: boolean;
    status: "idle" | "loading" | "refreshing" | "ready" | Failure;
    edge: "idle" | "loading" | "network" | "storage";
  } = { ...initial, status: "idle", edge: "idle" };
  let reader: Reader | undefined;
  let filterKey: string | undefined;
  let start = 0;
  let rawThrough = 0;
  let rowPages = new Map<string, number>();
  const deniedChannels = new Set<string>();
  let pending: AbortController | undefined;
  let closed = false;

  function publish(next: typeof state) {
    state = next;
    for (const listener of listeners) listener();
  }

  function readingWindow(anchor?: string) {
    const through = state.nextPage ?? rawThrough;
    return {
      through,
      window: collectionWindow(
        start,
        through,
        anchor ? rowPages.get(anchor) : undefined,
        1,
      ),
    };
  }

  async function read(
    direction: "first" | "older" | "newer",
    warm?: { anchor?: string; retry?: boolean },
  ) {
    const first = direction === "first";
    const newer = direction === "newer";
    const page = first ? 0 : newer ? start - 1 : state.nextPage;
    if (closed || pending || page === null || page < 0) return;
    const retry = state.status === "network" || state.status === "storage";
    const warmEmptyControl = Boolean(
      (warm && state.hasResponse) || state.manualPage,
    );
    const request = new AbortController();
    const { signal } = request;
    pending = request;
    publish(
      first
        ? {
            ...state,
            status: state.hasResponse ? "refreshing" : "loading",
            edge: "idle",
            newer: start ? "available" : undefined,
          }
        : newer
          ? { ...state, newer: "loading" }
          : { ...state, edge: "loading" },
    );
    try {
      const session =
        ((!first || (retry && (!warm || warm.retry))) && reader) ||
        (await account.openRecentMentions(archivedChannels, signal));
      signal.throwIfAborted();
      reader = session;
      const changed =
        filterKey !== undefined && session.filterKey !== filterKey;
      filterKey = session.filterKey;
      if (changed) {
        start = 0;
        rawThrough = 0;
        rowPages.clear();
        publish({ ...initial, status: "loading", edge: "idle" });
      }
      const window =
        first &&
        warm &&
        !changed &&
        state.hasResponse &&
        (state.items.length || state.manualPage || start > 0)
          ? readingWindow(warm.anchor).window
          : undefined;
      let from = changed ? 0 : (window?.start ?? page);
      const bound =
        newer || (!first && state.manualPage) ? from + 1 : window?.through;
      let rows = new Map<string, Page["items"][number]>();
      let positions = first ? new Map<string, number>() : rowPages;
      let cutoff = first || changed ? 0 : state.firstInaccessiblePostTime;
      let next: number | null = from;
      let last = from;
      async function readPages(through: number | undefined) {
        while (next !== null) {
          const current = next;
          const result = await session.readPage(current, signal, through);
          signal.throwIfAborted();
          last = result.page;
          for (const row of forgetPostChannel(result.items, deniedChannels)) {
            rows.set(row.id, row);
            positions.set(row.id, result.page);
          }
          cutoff = Math.max(cutoff, result.firstInaccessiblePostTime);
          next = result.nextPage;
          if (through === undefined || (next !== null && next >= through))
            break;
        }
      }
      await readPages(bound);
      signal.throwIfAborted();
      // Only a read at the start can establish that a search is empty.
      const restart =
        next === null && !rows.size && ((first && from > 0) || newer);
      if (restart) {
        // Only the start can confirm emptiness. A raw end above the retained
        // window rules out its older rows even if the head request fails.
        start = 0;
        rawThrough = 0;
        rowPages.clear();
        publish({ ...initial, status: "loading", edge: "idle" });
        from = 0;
        next = 0;
        positions = new Map();
        cutoff = 0;
        await readPages(1);
        signal.throwIfAborted();
      } else if (!first && !changed) {
        const existing = state.items.map((row) => [row.id, row] as const);
        rows = newer
          ? new Map([...rows, ...existing.filter(([id]) => !rows.has(id))])
          : new Map([...existing, ...rows]);
        if (newer) next = state.nextPage;
      }
      if (first || newer) start = from;
      if (!newer || restart || changed) rawThrough = last + 1;
      rowPages = positions;
      const items = forgetPostChannel([...rows.values()], deniedChannels);
      publish({
        status: "ready",
        edge: "idle",
        newer: start > 0 ? "available" : undefined,
        hasResponse: true,
        items,
        ...(warmEmptyControl &&
          !changed &&
          !items.length &&
          next !== null && { manualPage: true }),
        nextPage: next,
        firstInaccessiblePostTime: cutoff,
      });
    } catch (error) {
      if (signal.aborted) return;
      const status = workspaceFailure(error, "network");
      if (
        !first &&
        state.hasResponse &&
        (status === "network" || status === "storage")
      )
        publish(
          newer ? { ...state, newer: status } : { ...state, edge: status },
        );
      else if (mayKeepCache(status)) publish({ ...state, status });
      else {
        reader = undefined;
        filterKey = undefined;
        start = 0;
        rawThrough = 0;
        rowPages.clear();
        publish({ ...initial, nextPage: null, status, edge: "idle" });
      }
    } finally {
      if (pending === request) pending = undefined;
    }
  }
  function cancel() {
    pending?.abort();
    pending = undefined;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: () => read("first"),
    revalidate: (anchor?: string) => read("first", { anchor }),
    retry: (anchor?: string) => read("first", { anchor, retry: true }),
    retainReading(anchor?: string) {
      if (!state.hasResponse || !anchor) return;
      const { window, through } = readingWindow(anchor);
      const items = state.items.filter(({ id }) => {
        const page = rowPages.get(id);
        return (
          page !== undefined && page >= window.start && page < window.through
        );
      });
      start = window.start;
      rawThrough = window.through;
      rowPages = new Map(
        items.map(({ id }) => [id, rowPages.get(id) ?? start]),
      );
      publish({
        ...state,
        items,
        newer: start ? "available" : undefined,
        nextPage: window.through < through ? window.through : state.nextPage,
      });
    },
    load: () =>
      state.nextPage === null
        ? Promise.resolve()
        : read(state.hasResponse ? "older" : "first"),
    loadNewer: () => read("newer"),
    setChannelDenied(channelId: string, denied: boolean) {
      if (!denied) {
        deniedChannels.delete(channelId);
        return;
      }
      deniedChannels.add(channelId);
      const items = forgetPostChannel(state.items, deniedChannels);
      if (items.length === state.items.length) return;
      for (const row of state.items)
        if (row.channelId === channelId) rowPages.delete(row.id);
      publish({ ...state, items });
    },
    suspend() {
      cancel();
      reader = undefined;
      publish({
        ...state,
        status: state.hasResponse ? "ready" : "idle",
        edge: "idle",
        newer: start ? "available" : undefined,
      });
    },
    close() {
      closed = true;
      cancel();
      reader = undefined;
      rowPages.clear();
      deniedChannels.clear();
      listeners.clear();
      state = { ...initial, status: "idle", edge: "idle" };
    },
  };
}
