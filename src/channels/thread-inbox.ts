import { ResponseError } from "../../vendor/mattermost/index.js";
import type { accountFollowedThreads } from "../mattermost/account-followed-threads.ts";
import type { createChannelHistoryChanges } from "../mattermost/channel-history-changes.ts";
import {
  type ChannelPostChange,
  mergePostObservation,
} from "../mattermost/channel-post-records.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import type { RetainedThreadReplies } from "./thread-reply-window.ts";
import { mayKeepCache, workspaceFailure } from "./workspace-data.ts";

type Account = ReturnType<typeof accountFollowedThreads>;
type Reader = Pick<Account, "readFollowedThreads" | "readFollowedThreadTotals">;
type Row = Awaited<ReturnType<Reader["readFollowedThreads"]>>["items"][number];
type Read = Awaited<ReturnType<Account["markFollowedThreadRead"]>>;
type Totals = Awaited<ReturnType<Reader["readFollowedThreadTotals"]>>;
type ThreadInboxTab = "followed" | "unread";
export type ThreadInboxPlace = {
  tab: ThreadInboxTab;
  id: string;
  index: number;
  restoreRowLimit: number;
  position: { top: number; id?: string; offset: number };
};
export type ThreadReadingPlace = {
  top: number;
  id?: string;
  offset?: number;
  atEnd: boolean;
  composerHeight?: number;
  focus?: { kind: "reply"; id: string } | { kind: "feed" | "editor" };
};
export type ParkedThreadWindow = {
  replies: RetainedThreadReplies;
  place: ThreadReadingPlace;
};
const parkedWindowLimit = 4;
const windowKey = (channelId: string, id: string) =>
  JSON.stringify([channelId, id]);
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

type Root = NonNullable<Row["post"]>;

function withKnownFileNames(post: Root, prior?: Root | null): Root {
  const files = post.attachments;
  if (
    !files?.fileIds?.length ||
    !prior?.attachments?.files?.length ||
    prior.channelId !== post.channelId
  )
    return post;
  const observed = new Set(files.files?.map(({ id }) => id));
  const known = new Map(
    prior.attachments.files.map((file) => [file.id, file.name]),
  );
  const extra = files.fileIds.flatMap((id) => {
    const name = known.get(id);
    return !observed.has(id) && name ? [{ id, name }] : [];
  });
  return extra.length
    ? {
        ...post,
        attachments: { ...files, files: [...(files.files ?? []), ...extra] },
      }
    : post;
}

function updatedPost(prior: LocalPost, change: ChannelPostChange | undefined) {
  if (
    change?.kind !== "save" ||
    change.rootId !== prior.rootId ||
    change.updateAt <= prior.updateAt
  )
    return prior;
  const { kind: _kind, ...post } = change;
  return mergePostObservation(prior, post, "keep");
}

export function openThreadInbox(
  account: Reader,
  teamId: string,
  subscribeToHistory?: ReturnType<
    typeof createChannelHistoryChanges
  >["subscribe"],
) {
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
  const parked = new Map<string, ParkedThreadWindow>();
  const historySubscriptions = new Map<string, () => void>();
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
    parked.clear();
    syncHistorySubscriptions();
  }
  function withObservedRoots(rows: Row[]) {
    let current = rows;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const root = roots.get(row.id);
      if (!root || root.post === row.post) continue;
      if (current === rows) current = rows.slice();
      current[index] = { ...row, post: root.post };
    }
    return current;
  }
  function observeRoot(id: string, post: Row["post"], order: number) {
    const prior = roots.get(id);
    if (deniedRoots.has(id)) return;
    if (prior && order < prior.order) {
      // Later visibility wins; two visible roots can also be ordered by their server revisions.
      if (!post || !prior.post || post.updateAt <= prior.post.updateAt) return;
      order = prior.order;
    }
    if (post && prior?.post) {
      post =
        post.updateAt < prior.post.updateAt
          ? prior.post
          : withKnownFileNames(post, prior.post);
    }
    if (!post) discardRootWindow(id);
    roots.set(id, { order, post });
  }
  function discardRootWindow(id: string) {
    for (const [key, window] of parked) {
      if (window.replies.root.id === id) parked.delete(key);
    }
    syncHistorySubscriptions();
  }
  function revokeRoot(id: string) {
    if (closed || deniedRoots.has(id)) return;
    deniedRoots.add(id);
    discardRootWindow(id);
    roots.set(id, { order: ++pageReadOrder, post: null });
    updatePageRoots();
    publish();
  }
  function syncHistorySubscriptions() {
    if (!subscribeToHistory) return;
    const channels = new Set(
      [...parked.values()].map(({ replies }) => replies.root.channelId),
    );
    for (const [channelId, unsubscribe] of historySubscriptions) {
      if (channels.has(channelId)) continue;
      unsubscribe();
      historySubscriptions.delete(channelId);
    }
    for (const channelId of channels) {
      if (historySubscriptions.has(channelId)) continue;
      historySubscriptions.set(
        channelId,
        subscribeToHistory(channelId, (_source, changes) => {
          if (changes?.length) observeParkedPosts(channelId, changes);
        }),
      );
    }
  }
  function observeParkedPosts(
    channelId: string,
    changes: readonly ChannelPostChange[],
  ) {
    const byId = new Map(
      changes
        .filter((change) => change.channelId === channelId)
        .map((change) => [change.id, change]),
    );
    for (const [key, window] of parked) {
      const { root, replies, cardRevisions } = window.replies;
      if (root.channelId !== channelId) continue;
      const rootChange = byId.get(root.id);
      if (rootChange?.kind === "remove") {
        revokeRoot(root.id);
        continue;
      }
      const nextRoot = updatedPost(root, rootChange);
      const nextReplies = replies.flatMap((reply) => {
        const change = byId.get(reply.id);
        return change?.kind === "remove" ? [] : [updatedPost(reply, change)];
      });
      if (
        nextRoot === root &&
        nextReplies.length === replies.length &&
        nextReplies.every((reply, index) => reply === replies[index])
      )
        continue;
      const nextCardRevisions = new Map(cardRevisions);
      for (const reply of replies) {
        if (byId.get(reply.id)?.kind === "remove")
          nextCardRevisions.delete(reply.id);
      }
      const place = window.place;
      const id = place.id;
      const index = replies.findIndex((reply) => reply.id === id);
      const newId =
        index >= 0 && id && byId.get(id)?.kind === "remove"
          ? (
              replies
                .slice(index + 1)
                .find((reply) => byId.get(reply.id)?.kind !== "remove") ??
              nextReplies.at(-1)
            )?.id
          : id;
      const focus =
        place.focus?.kind === "reply" &&
        byId.get(place.focus.id)?.kind === "remove"
          ? { kind: "feed" as const }
          : place.focus;
      parked.set(key, {
        place: { ...place, id: newId, focus },
        replies: {
          ...window.replies,
          root: nextRoot,
          replies: nextReplies,
          cardRevisions: nextCardRevisions,
        },
      });
      if (nextRoot !== root && roots.has(root.id)) {
        observeRoot(root.id, nextRoot, ++pageReadOrder);
        updatePageRoots();
        publish();
      }
    }
  }
  function updatePageRoots() {
    for (const key of tabs) {
      const page = pages[key];
      if (!page.rows) continue;
      const rows = withObservedRoots(page.rows);
      if (rows !== page.rows) pages[key] = { ...page, rows };
    }
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
      // Root content can change on overlapping pages or while a read row is retained.
      for (const item of page.items) observeRoot(item.id, item.post, order);
      if (nextBefore) cursors[filter].add(nextBefore);
      pages[filter] = { status: "ready", rows, nextBefore };
      updatePageRoots();
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
    return showing ? show(tab) : refreshTotals();
  }
  function confirmRead(mark: Read) {
    const lastReply = Math.max(
      ...tabs.map(
        (filter) =>
          pages[filter].rows?.find((row) => row.id === mark.id)?.lastReplyAt ??
          0,
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
  }
  return {
    getSnapshot: () => current,
    isRootUnavailable: (id: string) =>
      deniedRoots.has(id) || roots.get(id)?.post === null,
    takeWindow(channelId: string, id: string) {
      const key = windowKey(channelId, id);
      const window = parked.get(key);
      parked.delete(key);
      syncHistorySubscriptions();
      return window;
    },
    parkWindow(window: ParkedThreadWindow) {
      const { id, channelId } = window.replies.root;
      if (
        closed ||
        deniedRoots.has(id) ||
        roots.get(id)?.post === null ||
        counts.status === "forbidden" ||
        counts.status === "unauthorized" ||
        counts.status === "session"
      )
        return;
      const key = windowKey(channelId, id);
      parked.delete(key);
      parked.set(key, window);
      if (parked.size > parkedWindowLimit) {
        const oldest = parked.keys().next();
        if (!oldest.done) parked.delete(oldest.value);
      }
      syncHistorySubscriptions();
    },
    beginRootRead() {
      const order = ++pageReadOrder;
      return (post: Root) => {
        if (closed || !showing || !roots.has(post.id)) return;
        observeRoot(post.id, post, order);
        updatePageRoots();
        publish();
      };
    },
    revokeRoot,
    discardChannelWindows(channelId: string) {
      for (const [key, window] of parked) {
        if (window.replies.root.channelId === channelId) parked.delete(key);
      }
      syncHistorySubscriptions();
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
    confirmRead,
    observeRead(mark: Read) {
      const changed = tabs.some((filter) =>
        pages[filter].rows?.some(
          (row) =>
            row.id === mark.id &&
            (row.lastViewedAt !== mark.lastViewedAt ||
              row.unreadReplies !== mark.unreadReplies ||
              row.unreadMentions !== mark.unreadMentions),
        ),
      );
      if (changed) void confirmRead(mark);
    },
    confirmUnfollow(id: string) {
      if (retainedReadId === id) retainedReadId = null;
      return afterConfirmation((row) => (row.id === id ? null : row));
    },
    confirmFollow() {
      if (closed) return Promise.resolve();
      cancelReads();
      for (const filter of tabs) {
        pages[filter] = { ...pages[filter], status: "idle" };
        cursors[filter].clear();
      }
      counts = { ...counts, status: "idle" };
      publish();
      return showing ? show(tab) : refreshTotals();
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
