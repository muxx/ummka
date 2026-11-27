import type { openAccountRestConnection } from "../mattermost/native-rest.ts";
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
    status: "idle" | "loading" | "refreshing" | "ready" | Failure;
    edge: "idle" | "loading" | "network" | "storage";
  } = { ...initial, status: "idle", edge: "idle" };
  let reader: Reader | undefined;
  let pending: AbortController | undefined;
  let closed = false;

  function publish(next: typeof state) {
    state = next;
    for (const listener of listeners) listener();
  }

  async function read(first: boolean) {
    const page = first ? 0 : state.nextPage;
    if (closed || pending || page === null) return;
    const retry = state.status === "network" || state.status === "storage";
    const request = new AbortController();
    pending = request;
    publish(
      first
        ? {
            ...state,
            status: state.hasResponse ? "refreshing" : "loading",
            edge: "idle",
          }
        : { ...state, edge: "loading" },
    );
    try {
      const session =
        ((!first || retry) && reader) ||
        (await account.openRecentMentions(archivedChannels, request.signal));
      request.signal.throwIfAborted();
      reader = session;
      const result = await session.readPage(page, request.signal);
      request.signal.throwIfAborted();
      const rows = new Map(
        first ? [] : state.items.map((row) => [row.id, row] as const),
      );
      for (const row of result.items) rows.set(row.id, row);
      publish({
        status: "ready",
        edge: "idle",
        hasResponse: true,
        items: Array.from(rows.values()),
        nextPage: result.nextPage,
        firstInaccessiblePostTime: Math.max(
          first ? 0 : state.firstInaccessiblePostTime,
          result.firstInaccessiblePostTime,
        ),
      });
    } catch (error) {
      if (request.signal.aborted) return;
      const status = workspaceFailure(error, "network");
      if (!first && (status === "network" || status === "storage"))
        publish({ ...state, edge: status });
      else if (mayKeepCache(status)) publish({ ...state, status });
      else {
        reader = undefined;
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
    refresh: () => read(true),
    load: () =>
      state.nextPage === null ? Promise.resolve() : read(!state.hasResponse),
    suspend() {
      cancel();
      reader = undefined;
      publish({
        ...state,
        status: state.hasResponse ? "ready" : "idle",
        edge: "idle",
      });
    },
    close() {
      closed = true;
      cancel();
      reader = undefined;
      listeners.clear();
    },
  };
}
