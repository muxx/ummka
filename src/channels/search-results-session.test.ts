import { expect, test, vi } from "vitest";
import type { accountSearch } from "../mattermost/account-search.ts";
import { openSearchResults } from "./search-results-session.ts";

type Account = ReturnType<typeof accountSearch>;
const first = "1".repeat(26),
  next = "2".repeat(26),
  c = "c".repeat(26);
const query = {
  teamId: null,
  terms: "release",
  timeZoneOffsetSeconds: 0,
  includeDeletedChannels: false,
  isOrSearch: false,
};
function fixture() {
  const account = {
    readPostSearchPage: vi.fn<Account["readPostSearchPage"]>(),
    readFileSearchPage: vi.fn<Account["readFileSearchPage"]>(),
  };
  return { account, session: openSearchResults(account, query) };
}
function page(ids: string[], time = 0) {
  return {
    items: ids.map((id) => ({ id, channelId: c, message: "old" })),
    isEnd: ids.length === 0,
    firstInaccessiblePostTime: time,
    matches: null,
  };
}
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("each tab starts when selected, keeps its page while hidden, and requests no duplicate page", async () => {
  const { account, session } = fixture();
  const deferred = gate<Awaited<ReturnType<Account["readPostSearchPage"]>>>();
  account.readPostSearchPage.mockReturnValueOnce(deferred.promise);
  account.readFileSearchPage.mockResolvedValueOnce({
    items: [],
    isEnd: true,
    firstInaccessibleFileTime: 16,
  });
  const initial = session.getSnapshot();
  const listener = vi.fn();
  const unsubscribe = session.subscribe(listener);
  const waiting = session.select("posts");
  await session.more();
  expect(session.getSnapshot().posts.status).toBe("loading");
  await session.select("files");
  expect(session.getSnapshot()).toMatchObject({
    selected: "files",
    files: { status: "ready", isEnd: true, retentionTime: 16 },
  });
  deferred.resolve(page([first], 34));
  await waiting;
  await session.select("posts");
  expect(session.getSnapshot()).toMatchObject({
    selected: "posts",
    posts: { status: "ready", items: [{ id: first }], retentionTime: 34 },
  });
  expect(initial.posts.items).toEqual([]);
  expect(account.readPostSearchPage).toHaveBeenCalledExactlyOnceWith(
    { ...query, page: 0 },
    expect.any(AbortSignal),
  );
  expect(account.readFileSearchPage).toHaveBeenCalledOnce();
  unsubscribe();
  const count = listener.mock.calls.length;
  await session.select("files");
  await session.more();
  expect(account.readFileSearchPage).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalledTimes(count);
});
test("overlapping pages update rows in place, retain highlights and stop on an empty server page", async () => {
  const { account, session } = fixture();
  account.readPostSearchPage
    .mockResolvedValueOnce({
      ...page([first, next], 25),
      matches: { [first]: ["previous"], [next]: ["both"] },
    })
    .mockResolvedValueOnce({
      ...page([first]),
      items: [{ id: first, channelId: c, message: "edited" }],
      matches: { [first]: ["edited"] },
    })
    .mockResolvedValueOnce(page([]));
  await session.select("posts");
  await session.more();
  expect(session.getSnapshot().posts).toMatchObject({
    items: [{ id: first, message: "edited" }, { id: next }],
    matches: { [first]: ["edited"], [next]: ["both"] },
    isEnd: false,
    retentionTime: 25,
  });
  await session.more();
  await session.more();
  expect(session.getSnapshot().posts).toMatchObject({
    isEnd: true,
    items: [{ id: first }, { id: next }],
  });
  expect(
    account.readPostSearchPage.mock.calls.map(([request]) => request.page),
  ).toEqual([0, 1, 2]);
});
test("a failed next page keeps the previous rows and only an explicit retry repeats that page", async () => {
  const { account, session } = fixture();
  account.readPostSearchPage
    .mockResolvedValueOnce(page([first]))
    .mockRejectedValueOnce("offline")
    .mockResolvedValueOnce(page([next]));
  await session.select("posts");
  await session.more();
  expect(session.getSnapshot().posts).toMatchObject({
    status: "error",
    error: "offline",
    items: [{ id: first }],
  });
  await session.more();
  await session.select("posts");
  expect(account.readPostSearchPage).toHaveBeenCalledTimes(2);
  await session.retry();
  expect(
    account.readPostSearchPage.mock.calls.map(([request]) => request.page),
  ).toEqual([0, 1, 1]);
  expect(session.getSnapshot().posts).toMatchObject({
    status: "ready",
    items: [{ id: first }, { id: next }],
    error: null,
  });
});
test("closing a query aborts both tabs, releases their rows and ignores either late answer", async () => {
  const { account, session } = fixture();
  const posts = gate<Awaited<ReturnType<Account["readPostSearchPage"]>>>(),
    files = gate<Awaited<ReturnType<Account["readFileSearchPage"]>>>();
  account.readPostSearchPage
    .mockResolvedValueOnce(page([first]))
    .mockReturnValueOnce(posts.promise);
  account.readFileSearchPage.mockReturnValueOnce(files.promise);
  await session.select("posts");
  const a = session.more(),
    b = session.select("files");
  session.close();
  expect(account.readPostSearchPage.mock.calls[1][1]?.aborted).toBe(true);
  expect(account.readFileSearchPage.mock.calls[0][1]?.aborted).toBe(true);
  const after = session.getSnapshot();
  posts.resolve(page([next]));
  files.resolve({ items: [], isEnd: true, firstInaccessibleFileTime: 2 });
  await Promise.all([a, b]);
  await session.select("posts");
  await session.retry();
  expect(after.posts.items).toEqual([]);
  expect(session.getSnapshot()).toBe(after);
  expect(account.readPostSearchPage).toHaveBeenCalledTimes(2);
});
