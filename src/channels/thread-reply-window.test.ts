import { expect, test, vi } from "vitest";
import { FetchError, ResponseError } from "../../vendor/mattermost/index.js";
import type { LocalPost } from "../mattermost/local-history.ts";
import type { ThreadPageRequest } from "../mattermost/thread-page.ts";
import { openThreadReplyWindow } from "./thread-reply-window.ts";

const channelId = "c".repeat(26),
  rootId = "r".repeat(26);
const scope = { channelId, rootId, collapsedThreads: true };
function local(id: string, time: number): LocalPost {
  return {
    id: id.repeat(26),
    channelId,
    rootId,
    userId: "u".repeat(26),
    createAt: time,
    updateAt: time,
    editAt: 0,
    message: id,
    type: "",
    hashtags: "",
    isPinned: false,
    messageSource: null,
  };
}
const focus = local("m", 100);
function wire(row: LocalPost) {
  return {
    ...row,
    rootId: row.rootId ?? "",
    messageSource: row.messageSource ?? undefined,
    deleteAt: 0,
  };
}
const root = wire({ ...local("r", 120), rootId: null });
function page(
  rows: LocalPost[],
  next: ThreadPageRequest["cursor"] = undefined,
  updateAt = 120,
) {
  return {
    kind: "page" as const,
    root: { ...root, updateAt, message: "root " + updateAt },
    replies: rows.map(wire),
    next: next ?? null,
  };
}
function pendingPage() {
  let resolve!: (result: ReturnType<typeof page>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<ReturnType<typeof page>>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { resolve, reject, promise };
}
const cursor = (row: LocalPost) => ({ id: row.id, createAt: row.createAt });
const messages = (view: ReturnType<typeof openThreadReplyWindow>) =>
  view.getSnapshot().replies.map((r) => r.message);

test.each(["up", "down"] as const)(
  "keeps the selected reply when %s arrives first, including tied times",
  async (first) => {
    const older = pendingPage(),
      newer = pendingPage();
    const readThreadPage = vi.fn((query: ThreadPageRequest) =>
      query.direction === "up" ? older.promise : newer.promise,
    );
    const view = openThreadReplyWindow({ readThreadPage }, scope, focus);
    const changed = vi.fn();
    const unsubscribe = view.subscribe(changed);
    expect(messages(view)).toEqual(["m"]);
    const opening = view.open();
    expect(view.open()).toBe(opening);
    await Promise.resolve();
    expect(readThreadPage.mock.calls.map(([query]) => query)).toEqual(
      ["up", "down"].map((direction) => ({
        ...scope,
        direction,
        cursor: cursor(focus),
      })),
    );
    const a = local("a", 100),
      b = local("b", 100),
      x = local("x", 100);
    if (first === "up") {
      older.resolve(page([b, a], undefined, 123));
      await view.more("up");
      expect(messages(view)).toEqual(["a", "b", "m"]);
    } else {
      newer.resolve(page([x], undefined, 122));
      await view.more("down");
      expect(messages(view)).toEqual(["m", "x"]);
    }
    older.resolve(page([b, a], undefined, 123));
    newer.resolve(page([x], undefined, 122));
    await opening;
    expect(messages(view)).toEqual(["a", "b", "m", "x"]);
    expect(view.getSnapshot().root?.message).toBe("root 123");
    await view.more("down");
    expect(readThreadPage).toHaveBeenCalledTimes(2);
    const notifications = changed.mock.calls.length;
    unsubscribe();
    view.close();
    expect(changed).toHaveBeenCalledTimes(notifications);
  },
);

test("keeps each boundary independent, retries the same cursor only on request after a network error", async () => {
  const reason = new Error("offline");
  const readThreadPage = vi
    .fn(async (query: ThreadPageRequest) => {
      if (query.direction === "down") return page([]);
      return page([local("a", 99)]);
    })
    .mockRejectedValueOnce(reason);
  const view = openThreadReplyWindow({ readThreadPage }, scope, focus);
  await view.open();
  expect(view.getSnapshot()).toMatchObject({
    up: { status: "error", error: reason },
    down: { status: "end" },
  });
  await view.more("up");
  await view.more("down");
  expect(readThreadPage).toHaveBeenCalledTimes(2);
  await view.retry("up");
  expect(readThreadPage.mock.calls[2]?.[0]).toEqual({
    ...scope,
    direction: "up",
    cursor: cursor(focus),
  });
  expect(messages(view)).toEqual(["a", "m"]);
  expect(view.getSnapshot().down).toEqual({
    status: "end",
  });
});

test.each(["up", "down"] as const)(
  "a server history limit on %s also hides the other side and the root",
  async (direction) => {
    const peer = pendingPage();
    const readThreadPage = vi.fn(async (query: ThreadPageRequest) =>
      query.direction === direction
        ? { kind: "inaccessible" as const, firstInaccessiblePostTime: 33 }
        : peer.promise,
    );
    const view = openThreadReplyWindow({ readThreadPage }, scope, focus);
    const opening = view.open();
    await vi.waitFor(() =>
      expect(view.getSnapshot().unavailable).toBe("limited"),
    );
    peer.resolve(page([local("x", 160)]));
    await opening;
    await view.more(direction);
    expect(view.getSnapshot()).toEqual({
      unavailable: "limited",
      firstInaccessiblePostTime: 33,
      root: null,
      replies: [],
      up: { status: "end" },
      down: { status: "end" },
    });
    expect(readThreadPage).toHaveBeenCalledTimes(2);
  },
);

test("a root-only page can advance without reading past the requested page", async () => {
  const first = pendingPage();
  const readThreadPage = vi
    .fn<(query: ThreadPageRequest) => Promise<ReturnType<typeof page>>>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(page([local("z", 120)]));
  const view = openThreadReplyWindow(
    { readThreadPage },
    { ...scope, collapsedThreads: false },
  );
  const open = view.open();
  const pending = view.more("down");
  expect(view.more("down")).toBe(pending);
  first.resolve(page([], { id: rootId, createAt: 120 }));
  await open;
  expect(view.getSnapshot()).toMatchObject({
    up: { status: "end" },
    down: { status: "ready" },
    replies: [],
  });
  expect(readThreadPage).toHaveBeenCalledTimes(1);
  await view.more("down");
  expect(readThreadPage.mock.calls[1]?.[0].cursor).toEqual({
    id: rootId,
    createAt: 120,
  });
  expect(messages(view)).toEqual(["z"]);
});

test("retains a loaded root and its replies during a retryable outage", async () => {
  const first = local("a", 140);
  const error = new ResponseError(new Response(null, { status: 503 }));
  const readThreadPage = vi
    .fn()
    .mockResolvedValueOnce(page([first], cursor(first)))
    .mockRejectedValueOnce(error)
    .mockResolvedValueOnce(page([local("z", 160)]));
  const view = openThreadReplyWindow({ readThreadPage }, scope);
  await view.open();
  const loaded = view.getSnapshot();
  await view.more("down");
  expect(view.getSnapshot()).toEqual({
    ...loaded,
    down: { status: "error", error },
  });
  await view.retry("down");
  expect(messages(view)).toEqual(["a", "z"]);
});

test("closing a thread aborts outstanding reads and clears the text even if the server answers late", async () => {
  const response = pendingPage();
  const readThreadPage = vi.fn(
    (_query: ThreadPageRequest, _signal?: AbortSignal) => response.promise,
  );
  const view = openThreadReplyWindow({ readThreadPage }, scope, focus);
  const opened = view.open();
  await Promise.resolve();
  view.close();
  expect(readThreadPage.mock.calls.every(([, signal]) => signal?.aborted)).toBe(
    true,
  );
  response.resolve(page([local("a", 90)]));
  await opened;
  await view.retry("up");
  expect(view.getSnapshot()).toEqual({
    root: null,
    replies: [],
    up: { status: "end" },
    down: { status: "end" },
  });
  expect(readThreadPage).toHaveBeenCalledTimes(2);
});

test.each([
  ["up", new ResponseError(new Response(null, { status: 403 })), "forbidden"],
  ["down", new ResponseError(new Response(null, { status: 404 })), "forbidden"],
  [
    "up",
    new ResponseError(new Response(null, { status: 401 })),
    "unauthorized",
  ],
  ["down", "unknown_connection", "session"],
  [
    "up",
    new FetchError(new TypeError("fetch", { cause: "session_unavailable" })),
    "session",
  ],
] as const)(
  "clears the whole thread when the %s page fails with %o",
  async (direction, error, unavailable) => {
    const older = local("a", 90);
    const newer = local("z", 150);
    const readThreadPage = vi.fn(
      async (query: ThreadPageRequest, _signal?: AbortSignal) => {
        const row = query.direction === "up" ? older : newer;
        return page([row], cursor(row));
      },
    );
    const view = openThreadReplyWindow({ readThreadPage }, scope, focus);
    await view.open();
    expect(view.getSnapshot().root?.id).toBe(rootId);
    expect(messages(view)).toEqual(["a", "m", "z"]);
    const failed = pendingPage();
    const late = pendingPage();
    const other = direction === "up" ? "down" : "up";
    readThreadPage.mockImplementation((query) =>
      query.direction === direction ? failed.promise : late.promise,
    );
    const failing = view.more(direction);
    const sibling = view.more(other);
    await Promise.resolve();
    failed.reject(error);
    await failing;
    const denied = view.getSnapshot();
    expect(denied).toEqual({
      unavailable,
      root: null,
      replies: [],
      up: { status: "end" },
      down: { status: "end" },
    });
    expect(readThreadPage.mock.calls[3]?.[1]?.aborted).toBe(true);
    late.resolve(page([local("b", 80)]));
    await sibling;
    await view.open();
    await view.retry(direction);
    await view.more(other);
    expect(readThreadPage).toHaveBeenCalledTimes(4);
    expect(view.getSnapshot()).toBe(denied);
  },
);

test("rejects foreign focus before starting a request and invalid page content without partial publication", async () => {
  const readThreadPage = vi.fn().mockResolvedValue({
    ...page([]),
    replies: [wire(local("a", 90)), { ...wire(local("b", 91)), message: 42 }],
  });
  expect(() =>
    openThreadReplyWindow({ readThreadPage }, scope, {
      ...focus,
      channelId: "d".repeat(26),
    }),
  ).toThrow(TypeError);
  expect(readThreadPage).not.toHaveBeenCalled();
  const view = openThreadReplyWindow({ readThreadPage }, scope);
  await view.open();
  expect(view.getSnapshot()).toMatchObject({
    root: null,
    replies: [],
    down: { status: "error" },
  });
});

test("a moved reply appearing again is rendered once at its newer position", async () => {
  const a = local("a", 50),
    b = local("b", 60),
    c = local("z", 80);
  const moved = { ...a, createAt: 70, updateAt: 150, message: "edited" };
  const readThreadPage = vi
    .fn()
    .mockResolvedValueOnce(page([a, b], cursor(b)))
    .mockResolvedValueOnce(page([moved, c]));
  const view = openThreadReplyWindow({ readThreadPage }, scope);
  await view.open();
  await view.more("down");
  expect(messages(view)).toEqual(["b", "edited", "z"]);
});

test("a subscriber can request the next page when the first page finishes", async () => {
  const a = local("a", 130),
    b = local("b", 145);
  const readThreadPage = vi
    .fn()
    .mockResolvedValueOnce(page([a], cursor(a)))
    .mockResolvedValueOnce(page([b]));
  const view = openThreadReplyWindow({ readThreadPage }, scope);
  let next: Promise<void> | undefined;
  view.subscribe(() => {
    if (view.getSnapshot().down.status === "ready") next = view.more("down");
  });
  await view.open();
  await next;
  expect(messages(view)).toEqual(["a", "b"]);
  expect(readThreadPage).toHaveBeenCalledTimes(2);
});

test("the read boundary includes tied read rows and waits beyond own replies for the first other author", async () => {
  const original = { lastViewedAt: 100, userId: "u".repeat(26) };
  const read1 = local("a", 100),
    read2 = local("b", 100),
    own = local("c", 101);
  const foreign = { ...local("d", 101), userId: "v".repeat(26) };
  const readThreadPage = vi.fn(async (q: ThreadPageRequest) => {
    if (q.direction === "up") return page([read2, read1]);
    return q.cursor ? page([foreign]) : page([own], cursor(own));
  });
  const view = openThreadReplyWindow({ readThreadPage }, scope, original);
  original.lastViewedAt = 101;
  expect(view.getUnreadPosition()).toEqual({ kind: "pending" });
  await view.open();
  expect(readThreadPage.mock.calls.map(([q]) => q)).toEqual([
    { ...scope, direction: "up", fromCreateAt: 101 },
    { ...scope, direction: "down", fromCreateAt: 100 },
  ]);
  expect(view.getSnapshot().replies.map((p) => p.id)).toEqual([
    read1.id,
    read2.id,
    own.id,
  ]);
  expect(view.getUnreadPosition()).toEqual({ kind: "pending" });
  await view.more("down");
  expect(readThreadPage.mock.lastCall?.[0].cursor).toEqual(cursor(own));
  expect(view.getUnreadPosition()).toEqual({
    kind: "found",
    postId: foreign.id,
  });
  view.close();
  expect(view.getUnreadPosition()).toBe(null);
});
test.each([
  [0, "down"],
  [Number.MAX_SAFE_INTEGER, "up"],
] as const)(
  "boundary %s has only one reachable direction",
  async (lastViewedAt, direction) => {
    const readThreadPage = vi.fn(async (_query: ThreadPageRequest) =>
      page([local("a", 50)]),
    );
    const view = openThreadReplyWindow({ readThreadPage }, scope, {
      lastViewedAt,
      userId: "u".repeat(26),
    });
    await view.open();
    expect(readThreadPage).toHaveBeenCalledExactlyOnceWith(
      { ...scope, direction, cursor: undefined },
      expect.any(AbortSignal),
    );
    expect(view.getUnreadPosition()).toEqual({ kind: "none" });
    view.close();
  },
);
test("failed unread lookup is not a confirmed end and a late response cannot publish after close", async () => {
  const delayed = pendingPage();
  const readThreadPage = vi.fn(async (query: ThreadPageRequest) =>
    query.direction === "up" ? page([]) : Promise.reject(Error("offline")),
  );
  const view = openThreadReplyWindow({ readThreadPage }, scope, {
    lastViewedAt: 200,
    userId: "u".repeat(26),
  });
  await view.open();
  expect(view.getSnapshot().down.status).toBe("error");
  expect(view.getUnreadPosition()).toEqual({ kind: "pending" });
  readThreadPage.mockImplementation(() => delayed.promise);
  const retry = view.retry("down");
  await Promise.resolve();
  view.close();
  delayed.resolve(page([{ ...local("z", 201), userId: "v".repeat(26) }]));
  await retry;
  expect(view.getSnapshot().replies).toEqual([]);
  expect(view.getUnreadPosition()).toBe(null);
});

test("an inaccessible unread window exposes the server limit without claiming no foreign answers", async () => {
  const readThreadPage = vi
    .fn()
    .mockResolvedValue({ kind: "inaccessible", firstInaccessiblePostTime: 33 });
  const view = openThreadReplyWindow({ readThreadPage }, scope, {
    lastViewedAt: 100,
    userId: "u".repeat(26),
  });
  await view.open();
  expect(view.getUnreadPosition()).toBe(null);
  expect(view.getSnapshot()).toMatchObject({
    unavailable: "limited",
    firstInaccessiblePostTime: 33,
    root: null,
    replies: [],
  });
});
