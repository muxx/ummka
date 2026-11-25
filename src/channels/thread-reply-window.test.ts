import { expect, test, vi } from "vitest";
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
  const promise = new Promise<ReturnType<typeof page>>((done) => {
    resolve = done;
  });
  return { resolve, promise };
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

test("keeps each boundary independent, retries the same cursor only on request and preserves the history limit", async () => {
  const reason = new Error("offline");
  const readThreadPage = vi
    .fn(async (query: ThreadPageRequest) => {
      if (query.direction === "down")
        return { kind: "inaccessible" as const, firstInaccessiblePostTime: 33 };
      return page([local("a", 99)]);
    })
    .mockRejectedValueOnce(reason);
  const view = openThreadReplyWindow({ readThreadPage }, scope, focus);
  await view.open();
  expect(view.getSnapshot()).toMatchObject({
    up: { status: "error", error: reason },
    down: { status: "inaccessible", since: 33 },
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
    status: "inaccessible",
    since: 33,
  });
});

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
