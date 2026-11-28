import { ResponseError } from "../../vendor/mattermost/index.js";
import type { accountFollowedThreads } from "../mattermost/account-followed-threads.ts";
import { mayKeepCache, workspaceFailure } from "./workspace-data.ts";

type Account = ReturnType<typeof accountFollowedThreads>;
type Reader = Pick<Account, "readFollowedThreads" | "readFollowedThreadTotals">;
type Row = Awaited<ReturnType<Reader["readFollowedThreads"]>>["items"][number];
type Read = Awaited<ReturnType<Account["markFollowedThreadRead"]>>;
type Totals = Awaited<ReturnType<Reader["readFollowedThreadTotals"]>>;
type ThreadInboxTab = "followed" | "unread";
type Key = ThreadInboxTab | "totals";
type Status =
  | "idle"
  | "loading"
  | "ready"
  | ReturnType<typeof workspaceFailure>;
type Page = { status: Status; rows: Row[] | null; nextBefore: string | null };
type Counts = { status: Status; value: Totals | null; serverError?: boolean };

const tabs = ["followed", "unread"] as const;
const blank = (status: Status = "idle"): Page => ({
  status,
  rows: null,
  nextBefore: null,
});

export function openThreadInbox(account: Reader, teamId: string) {
  let tab: ThreadInboxTab = "followed";
  let closed = false;
  let showing = false;
  let selectedId: string | null = null;
  let retainedReadId: string | null = null;
  let counts: Counts = { status: "idle", value: null };
  const pages = { followed: blank(), unread: blank() };
  const cursors = { followed: new Set<string>(), unread: new Set<string>() };
  let pageReadOrder = 0;
  const deniedRoots = new Set<string>();
  const roots = new Map<string, { order: number; post: Row["post"] }>();
  const pending = new Map<
    Key,
    { request: Promise<void>; controller: AbortController; previous: Status }
  >();
  const listeners = new Set<() => void>();
  const noUnreads = () =>
    counts.status === "ready" && counts.value?.totalUnreadThreads === 0;
  const snapshot = () => ({
    tab,
    page:
      tab === "unread" && pages.unread.status === "idle" && noUnreads()
        ? {
            rows: pages.unread.rows ?? [],
            nextBefore: null,
            status: "ready" as const,
          }
        : pages[tab],
    totals: counts,
    closed,
  });
  let current = snapshot();

  function publish() {
    current = snapshot();
    for (const listener of listeners) listener();
  }
  function reset(status: Status) {
    for (const filter of tabs) {
      pages[filter] = blank(status);
      cursors[filter].clear();
    }
    counts = { status, value: null };
    retainedReadId = null;
    roots.clear();
    deniedRoots.clear();
  }
  function withRootVisibility(rows: Row[]) {
    let current = rows;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (deniedRoots.has(row.id) && row.post) {
        if (current === rows) current = rows.slice();
        current[index] = { ...row, post: null };
        continue;
      }
      const root = roots.get(row.id);
      if (!root || (root.post === null) === (row.post === null)) continue;
      if (current === rows) current = rows.slice();
      current[index] = { ...row, post: root.post };
    }
    return current;
  }
  function cancelReads() {
    for (const [key, task] of pending) {
      task.controller.abort();
      if (key === "totals") counts = { ...counts, status: "idle" };
      else pages[key] = { ...pages[key], status: task.previous };
    }
    pending.clear();
  }
  function run(key: Key, read: (signal: AbortSignal) => Promise<void>) {
    if (closed) return Promise.resolve();
    const existing = pending.get(key);
    if (existing) return existing.request;
    const controller = new AbortController();
    const { signal } = controller;
    const request = Promise.resolve().then(async () => {
      if (signal.aborted) return;
      try {
        await read(signal);
      } catch (error) {
        if (signal.aborted) return;
        const status = workspaceFailure(error, "network");
        if (!mayKeepCache(status)) {
          cancelReads();
          reset(status);
          publish();
          return;
        }
        if (key === "totals")
          counts = {
            value: counts.value,
            status,
            ...(error instanceof ResponseError && { serverError: true }),
          };
        else pages[key] = { ...pages[key], status };
      }
      if (!signal.aborted) {
        pending.delete(key);
        publish();
        if (
          key === "totals" &&
          showing &&
          tab === "unread" &&
          pages.unread.status === "idle" &&
          counts.status === "ready" &&
          counts.value?.totalUnreadThreads
        )
          void fetchPage("unread");
      }
    });
    const previous = key === "totals" ? counts.status : pages[key].status;
    pending.set(key, { request, controller, previous });
    if (key === "totals") counts = { ...counts, status: "loading" };
    else pages[key] = { ...pages[key], status: "loading" };
    publish();
    return request;
  }
  function refreshTotals() {
    return run("totals", async (signal) => {
      const value = await account.readFollowedThreadTotals(teamId, signal);
      if (signal.aborted) return;
      const gainedUnread =
        counts.value?.totalUnreadThreads === 0 && value.totalUnreadThreads > 0;
      counts = { status: "ready", value };
      const unread = pages.unread;
      if (
        gainedUnread &&
        unread.status === "ready" &&
        unread.rows?.every((row) => row.id === retainedReadId) &&
        unread.nextBefore === null
      ) {
        pages.unread = { ...unread, status: "idle" };
        cursors.unread.clear();
      }
    });
  }
  function fetchPage(filter: ThreadInboxTab, before?: string) {
    if (closed) return Promise.resolve();
    if (
      filter === "unread" &&
      !before &&
      pages.unread.status === "idle" &&
      noUnreads()
    )
      return Promise.resolve();
    return run(filter, async (signal) => {
      const order = ++pageReadOrder;
      const page = await account.readFollowedThreads(
        { teamId, unread: filter === "unread", before },
        signal,
      );
      if (signal.aborted) return;
      const { nextBefore } = page;
      if (nextBefore && cursors[filter].has(nextBefore))
        throw Error("Repeated Mattermost thread list cursor.");
      const previous = pages[filter].rows ?? [];
      const ids = new Set(previous.map((row) => row.id));
      let rows = before
        ? previous.concat(page.items.filter((row) => !ids.has(row.id)))
        : page.items;
      const retained =
        !before && filter === "unread"
          ? previous.find((row) => row.id === retainedReadId)
          : undefined;
      if (retained) {
        if (rows.some((row) => row.id === retained.id)) retainedReadId = null;
        else rows = [retained, ...rows];
      }
      // A later complete observation owns visibility across both lists. Process
      // overlap before deduplication and never let an older reply expose a root.
      for (const item of page.items) {
        const root = roots.get(item.id);
        if (!root || root.order < order)
          roots.set(item.id, { order, post: item.post });
      }
      if (nextBefore) cursors[filter].add(nextBefore);
      pages[filter] = { status: "ready", rows, nextBefore };
      for (const key of tabs) {
        const page = pages[key];
        if (!page.rows) continue;
        const visible = withRootVisibility(page.rows);
        if (visible !== page.rows) pages[key] = { ...page, rows: visible };
      }
    });
  }
  function show(filter: ThreadInboxTab) {
    if (closed) return Promise.resolve();
    showing = true;
    if (tab !== filter) {
      tab = filter;
      publish();
    }
    const page = pages[filter];
    const rows =
      pending.get(filter)?.request ??
      (page.status === "idle" ? fetchPage(filter) : undefined);
    const totals =
      pending.get("totals")?.request ??
      (counts.status === "idle" ? refreshTotals() : undefined);
    return Promise.all([rows, totals]).then(() => {});
  }
  function afterConfirmation(
    change: (row: Row, filter: ThreadInboxTab) => Row | null,
  ) {
    if (closed) return Promise.resolve();
    cancelReads();
    for (const filter of tabs) {
      const page = pages[filter];
      if (page.rows)
        pages[filter] = {
          ...page,
          rows: page.rows.flatMap((row) => change(row, filter) ?? []),
        };
    }
    counts = { ...counts, status: "idle" };
    publish();
    return show(tab);
  }
  return {
    getSnapshot: () => current,
    isRootUnavailable: (id: string) =>
      deniedRoots.has(id) || roots.get(id)?.post === null,
    revokeRoot(id: string) {
      if (closed || deniedRoots.has(id)) return;
      deniedRoots.add(id);
      roots.set(id, { order: ++pageReadOrder, post: null });
      for (const filter of tabs) {
        const page = pages[filter];
        if (page.rows)
          pages[filter] = { ...page, rows: withRootVisibility(page.rows) };
      }
      publish();
    },
    hide() {
      if (closed || !showing) return;
      showing = false;
      for (const filter of tabs) {
        pending.get(filter)?.controller.abort();
        pending.delete(filter);
        pages[filter] = blank();
        cursors[filter].clear();
      }
      roots.clear();
      deniedRoots.clear();
      retainedReadId = null;
      selectedId = null;
      publish();
    },
    subscribe(listener: () => void) {
      if (!closed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    show,
    select(id: string | null) {
      if (closed || id === selectedId) return;
      selectedId = id;
      if (retainedReadId && pages.unread.rows) {
        pages.unread = {
          ...pages.unread,
          rows: pages.unread.rows.filter((row) => row.id !== retainedReadId),
        };
        retainedReadId = null;
        publish();
      }
    },
    loadMore() {
      const page = pages[tab];
      const active = pending.get(tab);
      if (active) return active.request;
      return page.status === "ready" && page.nextBefore
        ? fetchPage(tab, page.nextBefore)
        : Promise.resolve();
    },
    retryPage() {
      const page = pages[tab];
      return page.status === "ready" ||
        page.status === "idle" ||
        page.status === "loading"
        ? Promise.resolve()
        : fetchPage(tab, page.nextBefore ?? undefined);
    },
    refreshTotals,
    confirmRead(mark: Read) {
      const lastReply = Math.max(
        ...tabs.map(
          (filter) =>
            pages[filter].rows?.find((row) => row.id === mark.id)
              ?.lastReplyAt ?? 0,
        ),
      );
      const fullyRead =
        mark.unreadReplies === 0 && mark.lastViewedAt >= lastReply;
      return afterConfirmation((row, filter) => {
        if (row.id !== mark.id) return row;
        if (filter === "unread") {
          if (fullyRead) {
            if (mark.id !== selectedId) return null;
            retainedReadId = mark.id;
          } else if (retainedReadId === mark.id) retainedReadId = null;
        }
        return { ...row, ...mark };
      });
    },
    confirmUnfollow(id: string) {
      if (retainedReadId === id) retainedReadId = null;
      return afterConfirmation((row) => (row.id === id ? null : row));
    },
    reload() {
      if (closed) return Promise.resolve();
      cancelReads();
      reset("idle");
      publish();
      return show(tab);
    },
    close() {
      if (closed) return;
      closed = true;
      selectedId = null;
      cancelReads();
      reset("idle");
      publish();
      listeners.clear();
    },
  };
}
