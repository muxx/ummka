import type { accountSearch } from "../mattermost/account-search.ts";

type Account = ReturnType<typeof accountSearch>;
type Query = Omit<Parameters<Account["readPostSearchPage"]>[0], "page">;
type Kind = "posts" | "files";
type Highlights = Record<string, string[]> | null;
type Page<Row> = {
  items: Row[];
  isEnd: boolean;
  retentionTime: number;
  matches?: Highlights;
};
type Tab<Row> = {
  status: "idle" | "loading" | "ready" | "error";
  items: readonly Row[];
  matches: Highlights;
  retentionTime: number;
  isEnd: boolean;
  error: unknown;
};

function resultTab<Row extends { id: string }>(
  read: (page: number, signal: AbortSignal) => Promise<Page<Row>>,
  changed: () => void,
) {
  const initial: Tab<Row> = {
    status: "idle",
    items: [],
    matches: null,
    retentionTime: 0,
    isEnd: false,
    error: null,
  };
  const positions = new Map<string, number>();
  let state = initial,
    page = 0;
  let pending: AbortController | null = null;
  async function load() {
    if (pending || state.isEnd) return;
    const controller = new AbortController();
    pending = controller;
    state = { ...state, status: "loading", error: null };
    changed();
    try {
      controller.signal.throwIfAborted();
      const answer = await read(page, controller.signal);
      if (controller.signal.aborted) return;
      const items = state.items.slice();
      for (const row of answer.items) {
        const index = positions.get(row.id);
        if (index === undefined) {
          positions.set(row.id, items.length);
          items.push(row);
        } else items[index] = row;
      }
      state = {
        status: "ready",
        items,
        isEnd: answer.isEnd,
        retentionTime: Math.max(state.retentionTime, answer.retentionTime),
        matches: answer.matches
          ? { ...state.matches, ...answer.matches }
          : state.matches,
        error: null,
      };
      page++;
    } catch (error) {
      if (controller.signal.aborted) return;
      state = { ...state, status: "error", error };
    } finally {
      if (pending === controller) {
        pending = null;
        changed();
      }
    }
  }
  return {
    get state() {
      return state;
    },
    load,
    close() {
      const controller = pending;
      pending = null;
      controller?.abort();
      positions.clear();
      state = initial;
    },
  };
}

export function openSearchResults(account: Account, request: Query) {
  const query = { ...request };
  const listeners = new Set<() => void>();
  let selected: Kind = "posts",
    closed = false;
  const posts = resultTab(async (page, signal) => {
    const result = await account.readPostSearchPage({ ...query, page }, signal);
    return {
      items: result.items,
      matches: result.matches,
      isEnd: result.isEnd,
      retentionTime: result.firstInaccessiblePostTime,
    };
  }, changed);
  const files = resultTab(async (page, signal) => {
    const result = await account.readFileSearchPage({ ...query, page }, signal);
    return {
      items: result.items,
      isEnd: result.isEnd,
      retentionTime: result.firstInaccessibleFileTime,
    };
  }, changed);
  const tabs = { posts, files };
  function snapshot() {
    return { selected, posts: posts.state, files: files.state };
  }
  let current = snapshot();
  function changed() {
    current = snapshot();
    for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      if (!closed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async select(kind: Kind) {
      if (closed) return;
      const switched = selected !== kind;
      selected = kind;
      if (tabs[kind].state.status === "idle") await tabs[kind].load();
      else if (switched) changed();
    },
    async more() {
      const tab = tabs[selected];
      if (!closed && tab.state.status === "ready") await tab.load();
    },
    async retry() {
      const tab = tabs[selected];
      if (!closed && tab.state.status === "error") await tab.load();
    },
    close() {
      if (closed) return;
      closed = true;
      posts.close();
      files.close();
      changed();
      listeners.clear();
    },
  };
}
