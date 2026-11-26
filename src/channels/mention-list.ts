import type { openAccountRestConnection } from "../mattermost/native-rest.ts";
import { mayKeepCache, workspaceFailure } from "./workspace-data.ts";

type Account = Pick<
  Awaited<ReturnType<typeof openAccountRestConnection>>,
  "openRecentMentions"
>;
type Reader = Awaited<ReturnType<Account["openRecentMentions"]>>;
type Page = Awaited<ReturnType<Reader["readPage"]>>;

export function openMentionList(account: Account, archivedChannels: boolean) {
  const listeners = new Set<() => void>();
  const initial = {
    items: [] as Page["items"],
    nextPage: 0 as number | null,
    firstInaccessiblePostTime: 0,
  };
  let state: typeof initial & {
    status: "idle" | "loading" | "ready" | ReturnType<typeof workspaceFailure>;
  } = { ...initial, status: "idle" };
  let reader: Reader | undefined;
  let pending: AbortController | undefined;
  let closed = false;

  function publish(next: typeof state) {
    state = next;
    for (const listener of listeners) listener();
  }

  async function load() {
    const page = state.nextPage;
    if (closed || pending || page === null) return;
    const request = new AbortController();
    pending = request;
    publish({ ...state, status: "loading" });
    try {
      const session =
        reader ??
        (await account.openRecentMentions(archivedChannels, request.signal));
      if (request.signal.aborted) return;
      reader = session;
      const result = await session.readPage(page, request.signal);
      if (request.signal.aborted) return;
      const rows = new Map(state.items.map((row) => [row.id, row]));
      for (const row of result.items) rows.set(row.id, row);
      publish({
        status: "ready",
        items: Array.from(rows.values()),
        nextPage: result.nextPage,
        firstInaccessiblePostTime: Math.max(
          state.firstInaccessiblePostTime,
          result.firstInaccessiblePostTime,
        ),
      });
    } catch (error) {
      if (request.signal.aborted) return;
      const status = workspaceFailure(error, "network");
      publish(
        mayKeepCache(status)
          ? { ...state, status }
          : { ...initial, nextPage: null, status },
      );
    } finally {
      if (pending === request) pending = undefined;
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh() {
      if (
        state.status === "idle" ||
        state.status === "network" ||
        state.status === "storage"
      )
        return load();
    },
    load,
    close() {
      closed = true;
      pending?.abort();
      reader = undefined;
      listeners.clear();
    },
  };
}
