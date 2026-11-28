import { expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { openThreadInbox } from "./thread-inbox.ts";

type Reader = Parameters<typeof openThreadInbox>[0];
type Page = Awaited<ReturnType<Reader["readFollowedThreads"]>>;
const teamId = "t".repeat(26);
const row = (id: string, time = 50): Page["items"][number] => ({
  id: id.repeat(26),
  lastReplyAt: time,
  lastViewedAt: 1,
  unreadReplies: 2,
  unreadMentions: 1,
  post: null,
  participantIds: [],
  replyCount: 3,
  isUrgent: false,
});
const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => row(id));
const totals = {
  total: 100,
  totalUnreadThreads: 4,
  totalUnreadMentions: 6,
  totalUnreadUrgentMentions: 2,
};
const page = (items: Page["items"], more = false): Page => ({
  items,
  nextBefore: more ? (items.at(-1)?.id ?? null) : null,
});
function setup() {
  const account = {
    readFollowedThreads: vi.fn<Reader["readFollowedThreads"]>(),
    readFollowedThreadTotals: vi
      .fn<Reader["readFollowedThreadTotals"]>()
      .mockResolvedValue(totals),
  };
  return { account, view: openThreadInbox(account, teamId) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("filters own their pending first pages, independent cursors and accepted order", async () => {
  const { account, view } = setup();
  const first = deferred<Page>();
  account.readFollowedThreads
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(page([c], true))
    .mockResolvedValueOnce(page([a, d]));
  const all = view.show("followed");
  await view.show("unread");
  expect(view.getSnapshot().page.rows).toEqual([c]);
  first.resolve(page([a, b], true));
  await all;
  expect(view.getSnapshot().page.rows).toEqual([c]);
  await view.show("followed");
  const older = view.loadMore();
  expect(view.loadMore()).toBe(older);
  await older;
  expect(view.getSnapshot().page).toEqual({
    rows: [a, b, d],
    nextBefore: null,
    status: "ready",
  });
  expect(
    account.readFollowedThreads.mock.calls.map(([q]) => [q.unread, q.before]),
  ).toEqual([
    [false, undefined],
    [true, undefined],
    [false, b.id],
  ]);
  await view.loadMore();
  await view.show("unread");
  expect(view.getSnapshot().page.nextBefore).toBe(c.id);
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(3);
  expect(account.readFollowedThreadTotals).toHaveBeenCalledTimes(1);
});
test("an initial network failure and a failed edge require explicit retry", async () => {
  const { account, view } = setup();
  account.readFollowedThreads
    .mockRejectedValueOnce(Error())
    .mockResolvedValueOnce(page([a], true))
    .mockRejectedValueOnce(Error())
    .mockResolvedValueOnce(page([]));
  await view.show("followed");
  expect(view.getSnapshot().page).toEqual({
    status: "network",
    rows: null,
    nextBefore: null,
  });
  await view.show("followed");
  await view.loadMore();
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(1);
  await view.retryPage();
  await view.loadMore();
  expect(view.getSnapshot().page).toEqual({
    status: "network",
    rows: [a],
    nextBefore: a.id,
  });
  await view.loadMore();
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(3);
  await view.retryPage();
  expect(view.getSnapshot().page).toEqual({
    status: "ready",
    rows: [a],
    nextBefore: null,
  });
});
test("a confirmed zero supplies an empty unread tab, a newer positive total loads it", async () => {
  const { account, view } = setup();
  account.readFollowedThreads
    .mockResolvedValueOnce(page([a]))
    .mockResolvedValueOnce(page([b]));
  account.readFollowedThreadTotals.mockResolvedValueOnce({
    ...totals,
    totalUnreadThreads: 0,
  });
  await view.show("followed");
  await view.show("unread");
  expect(view.getSnapshot().page).toEqual({
    rows: [],
    status: "ready",
    nextBefore: null,
  });
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(1);
  await view.refreshTotals();
  await view.loadMore();
  expect(view.getSnapshot().page.rows).toEqual([b]);
});
test("a mark uses the server time predicate and a withdrawn cursor survives a late page", async () => {
  const { account, view } = setup();
  const late = deferred<Page>();
  account.readFollowedThreads
    .mockResolvedValueOnce(page([a, b], true))
    .mockResolvedValueOnce(page([a, b], true))
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce(page([c]));
  await view.show("followed");
  await view.show("unread");
  const loading = view.loadMore();
  await Promise.resolve();
  const signal = account.readFollowedThreads.mock.calls.at(-1)?.[1];
  await view.confirmRead({
    id: a.id,
    lastViewedAt: a.lastReplyAt,
    unreadReplies: 0,
    unreadMentions: 1,
  });
  expect(signal?.aborted).toBe(true);
  await view.confirmUnfollow(b.id);
  late.resolve(page([a, b, d]));
  await loading;
  expect(view.getSnapshot().page).toEqual({
    status: "ready",
    rows: [],
    nextBefore: b.id,
  });
  await view.loadMore();
  expect(account.readFollowedThreads.mock.calls.at(-1)?.[0].before).toBe(b.id);
  expect(view.getSnapshot().page.rows).toEqual([c]);
  await view.show("followed");
  expect(view.getSnapshot().page.rows).toEqual([
    { ...a, lastViewedAt: a.lastReplyAt, unreadReplies: 0, unreadMentions: 1 },
  ]);
});
test("a repeated cursor cannot loop or advance after rejecting a page", async () => {
  const { account, view } = setup();
  account.readFollowedThreads
    .mockResolvedValueOnce(page([a], true))
    .mockResolvedValueOnce(page([b], true))
    .mockResolvedValueOnce(page([a], true));
  await view.show("followed");
  await view.loadMore();
  await view.loadMore();
  expect(view.getSnapshot().page).toEqual({
    status: "network",
    rows: [a, b],
    nextBefore: b.id,
  });
  await view.loadMore();
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(3);
});
test("bulk confirmation starts new reads, discards the previous request and sees the new reply", async () => {
  const { account, view } = setup();
  const stale = deferred<Page>();
  account.readFollowedThreads
    .mockResolvedValueOnce(page([a]))
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValueOnce(page([b]))
    .mockResolvedValueOnce(page([b, c]));
  await view.show("followed");
  const waiting = view.show("unread");
  await Promise.resolve();
  account.readFollowedThreadTotals.mockResolvedValueOnce({
    ...totals,
    totalUnreadThreads: 1,
  });
  await view.reload();
  stale.resolve(page([]));
  await waiting;
  expect(view.getSnapshot().page.rows).toEqual([b]);
  expect(view.getSnapshot().totals.value?.totalUnreadThreads).toBe(1);
  await view.show("followed");
  expect(view.getSnapshot().page.rows).toEqual([b, c]);
});
test.each([401, 403, 404])(
  "loss of access (%s) clears both filters and totals",
  async (status) => {
    const { account, view } = setup();
    const late = deferred<Page>();
    account.readFollowedThreads
      .mockResolvedValueOnce(page([a], true))
      .mockResolvedValueOnce(page([b], true))
      .mockReturnValueOnce(late.promise);
    await view.show("followed");
    await view.show("unread");
    const edge = view.loadMore();
    await Promise.resolve();
    account.readFollowedThreadTotals.mockRejectedValueOnce(
      new ResponseError(new Response(null, { status })),
    );
    await view.refreshTotals();
    late.resolve(page([c]));
    await edge;
    const failure = status === 401 ? "unauthorized" : "forbidden";
    expect(view.getSnapshot().totals).toEqual({ status: failure, value: null });
    expect(view.getSnapshot().page.rows).toBe(null);
    await view.show("followed");
    expect(view.getSnapshot().page).toEqual({
      rows: null,
      status: failure,
      nextBefore: null,
    });
  },
);
test("a totals failure does not hide real rows, and close retires pending work and listeners", async () => {
  const { account, view } = setup();
  const listener = vi.fn();
  view.subscribe(listener);
  account.readFollowedThreadTotals.mockRejectedValueOnce(Error());
  account.readFollowedThreads.mockResolvedValueOnce(page([a], true));
  await view.show("followed");
  expect(view.getSnapshot().totals).toEqual({ status: "network", value: null });
  expect(view.getSnapshot().page.rows).toEqual([a]);
  const late = deferred<Page>();
  account.readFollowedThreads.mockReturnValueOnce(late.promise);
  const load = view.loadMore();
  await Promise.resolve();
  view.close();
  const closed = view.getSnapshot();
  const calls = listener.mock.calls.length;
  late.resolve(page([b]));
  await load;
  await view.show("unread");
  await view.refreshTotals();
  await view.confirmUnfollow(a.id);
  expect(view.getSnapshot()).toBe(closed);
  expect(closed.closed).toBe(true);
  expect(closed.page.rows).toBe(null);
  expect(closed.totals.value).toBe(null);
  expect(listener).toHaveBeenCalledTimes(calls);
});

test("only the already loaded selected read row survives until the next selection", async () => {
  const { account, view } = setup();
  account.readFollowedThreads
    .mockResolvedValueOnce(page([a, b], true))
    .mockResolvedValueOnce(page([c]));
  await view.show("unread");
  view.select(a.id);
  const mark = {
    id: a.id,
    lastViewedAt: a.lastReplyAt,
    unreadReplies: 0,
    unreadMentions: 1,
  };
  await view.confirmRead(mark);
  expect(view.getSnapshot().page.rows).toEqual([{ ...a, ...mark }, b]);
  view.select(d.id);
  expect(view.getSnapshot().page).toEqual({
    rows: [b],
    status: "ready",
    nextBefore: b.id,
  });
  await view.loadMore();
  expect(account.readFollowedThreads.mock.calls.at(-1)?.[0].before).toBe(b.id);
  expect(view.getSnapshot().page.rows).toEqual([b, c]);
  await view.confirmRead({ ...mark, id: d.id });
  expect(view.getSnapshot().page.rows).toEqual([b, c]);
  expect(view.getSnapshot().page.nextBefore).toBeNull();
  view.select(b.id);
  await view.confirmRead({ ...mark, id: b.id });
  await view.confirmUnfollow(b.id);
  expect(view.getSnapshot().page.rows).toEqual([c]);
});

test("a server-confirmed unread reply newer than the cached row keeps its unread membership", async () => {
  const { account, view } = setup();
  account.readFollowedThreads.mockResolvedValueOnce(page([a]));
  await view.show("unread");
  const mark = {
    id: a.id,
    lastViewedAt: a.lastReplyAt + 1,
    unreadReplies: 1,
    unreadMentions: 0,
  };
  await view.confirmRead(mark);
  expect(view.getSnapshot().page.rows).toEqual([{ ...a, ...mark }]);
});

test("a read confirmation must reach the newest reply known in either tab", async () => {
  const { account, view } = setup();
  const newer = { ...a, lastReplyAt: a.lastReplyAt + 10 };
  account.readFollowedThreads
    .mockResolvedValueOnce(page([a]))
    .mockResolvedValueOnce(page([newer]));
  await view.show("unread");
  await view.show("followed");
  await view.show("unread");
  const partial = {
    id: a.id,
    lastViewedAt: a.lastReplyAt,
    unreadReplies: 0,
    unreadMentions: 1,
  };
  await view.confirmRead(partial);
  expect(view.getSnapshot().page.rows).toEqual([{ ...a, ...partial }]);
  await view.confirmRead({ ...partial, lastViewedAt: newer.lastReplyAt });
  expect(view.getSnapshot().page.rows).toEqual([]);
});

test("new unread totals settle and can refresh while their first page is pending", async () => {
  const { account, view } = setup();
  const started = deferred<void>();
  const held = deferred<Page>();
  account.readFollowedThreads
    .mockResolvedValueOnce(page([a]))
    .mockImplementationOnce(() => {
      started.resolve();
      return held.promise;
    });
  account.readFollowedThreadTotals.mockResolvedValueOnce({
    ...totals,
    totalUnreadThreads: 0,
  });
  await view.show("followed");
  await view.show("unread");
  const positive = view.refreshTotals();
  await started.promise;
  const nextCounts = { ...totals, totalUnreadThreads: 2 };
  account.readFollowedThreadTotals.mockResolvedValueOnce(nextCounts);
  const refresh = view.refreshTotals();
  expect(refresh).not.toBe(positive);
  await refresh;
  expect(view.getSnapshot().totals).toEqual({
    status: "ready",
    value: nextCounts,
  });
  expect(view.getSnapshot().page.status).toBe("loading");
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(2);
  const firstPage = view.loadMore();
  held.resolve(page([b]));
  await firstPage;
  expect(view.getSnapshot().page.rows).toEqual([b]);
});

test.each(["unread", "followed"] as const)(
  "new totals invalidate a loaded empty unread page while %s is active",
  async (active) => {
    const { account, view } = setup();
    account.readFollowedThreadTotals.mockResolvedValueOnce({
      ...totals,
      totalUnreadThreads: 0,
    });
    let latestUnread = page([]);
    account.readFollowedThreads.mockImplementation(async ({ unread }) =>
      unread ? latestUnread : page([a]),
    );
    await view.show("unread");
    expect(view.getSnapshot().page).toEqual({
      status: "ready",
      rows: [],
      nextBefore: null,
    });
    await view.show(active);
    const unreadRequests = () =>
      account.readFollowedThreads.mock.calls.filter(
        ([request]) => request.unread,
      ).length;
    expect(unreadRequests()).toBe(1);
    latestUnread = page([b]);
    await view.refreshTotals();
    if (active === "followed") {
      expect(view.getSnapshot().page.rows).toEqual([a]);
      expect(unreadRequests()).toBe(1);
    } else {
      await view.loadMore();
      expect(view.getSnapshot().page.rows).toEqual([b]);
      expect(unreadRequests()).toBe(2);
    }
    await view.show("unread");
    expect(view.getSnapshot().page.rows).toEqual([b]);
    expect(unreadRequests()).toBe(2);
  },
);

test("a persistently empty unread page and positive total do not cause rereads", async () => {
  const { account, view } = setup();
  account.readFollowedThreads.mockResolvedValue(page([]));
  account.readFollowedThreadTotals.mockResolvedValueOnce({
    ...totals,
    totalUnreadThreads: 0,
  });
  await view.show("unread");
  await view.refreshTotals();
  await view.loadMore();
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(2);
  expect(view.getSnapshot().page.rows).toEqual([]);
  await view.refreshTotals();
  await view.show("unread");
  await view.loadMore();
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(2);
  expect(view.getSnapshot().totals.value).toEqual(totals);
});

test("a new positive total does not restart an unread page with a saved cursor", async () => {
  const { account, view } = setup();
  account.readFollowedThreads
    .mockResolvedValueOnce(page([a], true))
    .mockResolvedValueOnce(page([b]));
  await view.show("unread");
  account.readFollowedThreadTotals.mockResolvedValueOnce({
    ...totals,
    totalUnreadThreads: 0,
  });
  await view.confirmUnfollow(a.id);
  await view.refreshTotals();
  await view.show("unread");
  expect(view.getSnapshot().page).toEqual({
    status: "ready",
    rows: [],
    nextBefore: a.id,
  });
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(1);
  await view.loadMore();
  expect(account.readFollowedThreads.mock.calls[1]?.[0].before).toBe(a.id);
  expect(view.getSnapshot().page.rows).toEqual([b]);
});

const observedRoot = {
  id: a.id,
  channelId: "c".repeat(26),
  userId: "u".repeat(26),
  rootId: null,
  message: "A visible root",
  messageSource: null,
  createAt: 1,
  updateAt: 1,
  editAt: 0,
  deleteAt: 0,
  type: "",
  hashtags: "",
  isPinned: false,
};
const visibleA = { ...a, post: observedRoot };

test.each([true, false])(
  "the most recently requested missing root wins when it returns first: %s",
  async (missingFirst) => {
    const { account, view } = setup();
    const older = deferred<Page>();
    const newer = deferred<Page>();
    account.readFollowedThreads
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const followed = view.show("followed");
    await Promise.resolve();
    const unread = view.show("unread");
    const missing = { ...a, unreadReplies: 1 };
    if (missingFirst) {
      newer.resolve(page([missing]));
      await unread;
      older.resolve(page([visibleA]));
      await followed;
    } else {
      older.resolve(page([visibleA]));
      await followed;
      newer.resolve(page([missing]));
      await unread;
    }
    expect(view.getSnapshot().page.rows).toEqual([missing]);
    await view.show("followed");
    expect(view.getSnapshot().page.rows).toEqual([a]);
    expect(account.readFollowedThreads).toHaveBeenCalledTimes(2);
  },
);

test("a duplicate on a later page clears only the root without replacing its ordered row", async () => {
  const { account, view } = setup();
  account.readFollowedThreads
    .mockResolvedValueOnce(page([visibleA, b], true))
    .mockResolvedValueOnce(page([{ ...a, unreadReplies: 0 }, c], true))
    .mockResolvedValueOnce(page([visibleA, d]));
  await view.show("followed");
  await view.loadMore();
  expect(view.getSnapshot().page).toEqual({
    status: "ready",
    rows: [a, b, c],
    nextBefore: c.id,
  });
  await view.loadMore();
  expect(view.getSnapshot().page.rows).toEqual([visibleA, b, c, d]);
  expect(
    account.readFollowedThreads.mock.calls.map(([query]) => query.before),
  ).toEqual([undefined, b.id, c.id]);
});

test("dropping the retained row does not erase a newer observation of a missing root", async () => {
  const { account, view } = setup();
  const older = deferred<Page>();
  account.readFollowedThreads
    .mockResolvedValueOnce(page([visibleA, b], true))
    .mockReturnValueOnce(older.promise)
    .mockResolvedValueOnce(page([a]));
  await view.show("unread");
  view.select(a.id);
  await view.confirmRead({
    id: a.id,
    lastViewedAt: a.lastReplyAt,
    unreadReplies: 0,
    unreadMentions: 0,
  });
  expect(view.getSnapshot().page.rows?.[0]?.post).toEqual(observedRoot);
  const followed = view.show("followed");
  await view.show("unread");
  await view.loadMore();
  expect(view.getSnapshot().page.rows?.[0]?.post).toBeNull();
  view.select(null);
  expect(view.getSnapshot().page.rows).toEqual([b]);
  older.resolve(page([visibleA]));
  await followed;
  await view.show("followed");
  expect(view.getSnapshot().page.rows).toEqual([a]);
});

test.each([true, false])(
  "a fresh unread page keeps the selected read row until deselection before reply: %s",
  async (deselectFirst) => {
    const { account, view } = setup();
    const arrival = deferred<Page>();
    account.readFollowedThreads
      .mockResolvedValueOnce(page([a]))
      .mockReturnValueOnce(arrival.promise);
    await view.show("unread");
    view.select(a.id);
    account.readFollowedThreadTotals.mockResolvedValueOnce({
      ...totals,
      totalUnreadThreads: 0,
    });
    const mark = {
      id: a.id,
      lastViewedAt: a.lastReplyAt,
      unreadReplies: 0,
      unreadMentions: 0,
    };
    await view.confirmRead(mark);
    await view.refreshTotals();
    const retained = { ...a, ...mark };
    expect(view.getSnapshot().page).toEqual({
      status: "loading",
      rows: [retained],
      nextBefore: null,
    });
    const loading = view.loadMore();
    if (deselectFirst) {
      view.select(null);
      expect(view.getSnapshot().page.rows).toEqual([]);
    }
    arrival.resolve(page([b], true));
    await loading;
    expect(view.getSnapshot().page).toEqual({
      status: "ready",
      rows: deselectFirst ? [b] : [retained, b],
      nextBefore: b.id,
    });
    view.select(null);
    expect(view.getSnapshot().page.rows).toEqual([b]);
    expect(view.getSnapshot().totals.value).toEqual(totals);
    expect(account.readFollowedThreads).toHaveBeenCalledTimes(2);
  },
);

test("a retained row that becomes unread remains in the list after deselection", async () => {
  const { account, view } = setup();
  const latest = { ...a, lastReplyAt: a.lastReplyAt + 10, replyCount: 4 };
  account.readFollowedThreads
    .mockResolvedValueOnce(page([a]))
    .mockResolvedValueOnce(page([latest]));
  await view.show("unread");
  view.select(a.id);
  account.readFollowedThreadTotals.mockResolvedValueOnce({
    ...totals,
    totalUnreadThreads: 0,
  });
  await view.confirmRead({
    id: a.id,
    lastViewedAt: a.lastReplyAt,
    unreadReplies: 0,
    unreadMentions: 0,
  });
  await view.refreshTotals();
  await view.loadMore();
  view.select(null);
  expect(view.getSnapshot().page.rows).toEqual([latest]);
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(2);
});

test("cancelling a first unread reread preserves the need to fetch past the retained row", async () => {
  const { account, view } = setup();
  const stale = deferred<Page>();
  account.readFollowedThreads
    .mockResolvedValueOnce(page([a]))
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValueOnce(page([c]));
  await view.show("unread");
  view.select(a.id);
  account.readFollowedThreadTotals.mockResolvedValueOnce({
    ...totals,
    totalUnreadThreads: 0,
  });
  const mark = {
    id: a.id,
    lastViewedAt: a.lastReplyAt,
    unreadReplies: 0,
    unreadMentions: 0,
  };
  await view.confirmRead(mark);
  await view.refreshTotals();
  const canceled = view.loadMore();
  await view.confirmRead(mark);
  const expected = [{ ...a, ...mark }, c];
  expect(view.getSnapshot().page.rows).toEqual(expected);
  stale.resolve(page([b]));
  await canceled;
  expect(view.getSnapshot().page.rows).toEqual(expected);
});
test("leaving the inbox discards a late page and accepts sidebar totals without reading a hidden list", async () => {
  const { account, view } = setup();
  const list = deferred<Page>(),
    counts = deferred<typeof totals>();
  account.readFollowedThreads.mockReturnValueOnce(list.promise);
  account.readFollowedThreadTotals.mockReturnValueOnce(counts.promise);
  const open = view.show("unread");
  await Promise.resolve();
  view.hide();
  expect(account.readFollowedThreads.mock.calls[0][1]?.aborted).toBe(true);
  counts.resolve(totals);
  list.resolve(page([a]));
  await open;
  expect(view.getSnapshot().totals).toEqual({ status: "ready", value: totals });
  expect(view.getSnapshot().page.rows).toBeNull();
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(1);
  expect(account.readFollowedThreadTotals).toHaveBeenCalledTimes(1);
});
