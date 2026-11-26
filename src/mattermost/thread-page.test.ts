import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, test, vi } from "vitest";
import { type PostList, PostsApi } from "../../vendor/mattermost/index.js";
import { openAccountRestConnection } from "./native-rest.ts";
import { readThreadPage, type ThreadPageRequest } from "./thread-page.ts";

const rootId = "r".repeat(26),
  channelId = "c".repeat(26);
const idA = "a".repeat(26),
  idB = "b".repeat(26);
const request: ThreadPageRequest = {
  channelId,
  rootId,
  collapsedThreads: true,
  direction: "down",
};
function post(id: string, root: string) {
  return {
    id,
    rootId: root,
    channelId,
    createAt: 1000,
    deleteAt: 0,
    message: id,
  };
}
const root = post(rootId, ""),
  first = post(idA, rootId),
  last = post(idB, rootId);
function page(order: string[], hasNext = false): PostList {
  return {
    order,
    posts: { [rootId]: root, [idA]: first, [idB]: last },
    hasNext,
  };
}
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});

test("passes both cursor fields and reads one page even when reply times are identical", async () => {
  const api = {
    getPostThread: vi
      .fn()
      .mockResolvedValueOnce(page([rootId, idA], true))
      .mockResolvedValueOnce(page([rootId, idB])),
  };
  const controller = new AbortController();
  const initial = await readThreadPage(api, request, controller.signal);
  expect(initial).toEqual({
    kind: "page",
    root: { ...root, isFollowing: false },
    replies: [first],
    next: { id: idA, createAt: 1000 },
  });
  expect(api.getPostThread).toHaveBeenCalledTimes(1);
  if (initial.kind !== "page" || !initial.next) throw Error("Missing cursor");
  const next = await readThreadPage(
    api,
    { ...request, cursor: initial.next },
    controller.signal,
  );
  expect(api.getPostThread).toHaveBeenLastCalledWith(
    {
      postId: rootId,
      collapsedThreads: true,
      direction: "down",
      perPage: 60,
      fromPost: idA,
      fromCreateAt: 1000,
    },
    { signal: controller.signal },
  );
  expect(next).toEqual({
    kind: "page",
    root: { ...root, isFollowing: false },
    replies: [last],
    next: null,
  });
});
test("distinguishes an empty thread, a flat first page and a retention limit", async () => {
  const api = {
    getPostThread: vi
      .fn()
      .mockResolvedValueOnce(page([rootId]))
      .mockResolvedValueOnce(page([rootId], true))
      .mockResolvedValueOnce({ order: [], firstInaccessiblePostTime: 42 }),
  };
  expect(await readThreadPage(api, request)).toEqual({
    kind: "page",
    root: { ...root, isFollowing: false },
    replies: [],
    next: null,
  });
  expect(
    await readThreadPage(api, {
      ...request,
      collapsedThreads: false,
      perPage: 1,
    }),
  ).toEqual({
    kind: "page",
    root,
    replies: [],
    next: { id: rootId, createAt: 1000 },
  });
  expect(await readThreadPage(api, request)).toEqual({
    kind: "inaccessible",
    firstInaccessiblePostTime: 42,
  });
});
test.each([true, false, undefined])(
  "only a collapsed root supplies a personal following state (%s)",
  async (isFollowing) => {
    const api = {
      getPostThread: vi.fn().mockResolvedValue({
        ...page([rootId, idA, idB]),
        posts: {
          [rootId]: { ...root, isFollowing },
          [idA]: { ...first, isFollowing: true },
          [idB]: { ...last, isFollowing: false },
        },
      }),
    };
    for (const collapsedThreads of [true, false]) {
      const result = await readThreadPage(api, {
        ...request,
        collapsedThreads,
      });
      expect(result.kind === "page" && result.root.isFollowing).toBe(
        collapsedThreads ? (isFollowing ?? false) : undefined,
      );
      expect(
        result.kind === "page" &&
          result.replies.map((reply) => Object.hasOwn(reply, "isFollowing")),
      ).toEqual([false, false]);
    }
    expect(api.getPostThread).toHaveBeenCalledTimes(2);
  },
);

test("rejects a malformed subscription on a visible collapsed root", async () => {
  const api = {
    getPostThread: vi.fn().mockResolvedValue({
      ...page([rootId]),
      posts: { [rootId]: { ...root, isFollowing: "false" } },
    }),
  };
  await expect(readThreadPage(api, request)).rejects.toThrow(TypeError);
});

test("rejects a different thread, repeated or missing rows and a stalled cursor", async () => {
  const visible = page([rootId, idA]);
  for (const invalid of [
    page([idA, rootId]),
    page([rootId, idA, idA]),
    page([rootId, "z".repeat(26)]),
    { ...visible, posts: { [rootId]: root, [idA]: { ...first, rootId: idB } } },
    {
      ...visible,
      posts: { [rootId]: { ...root, channelId: idB }, [idA]: first },
    },
    { ...visible, posts: { [rootId]: root, [idA]: { ...first, deleteAt: 1 } } },
    { ...visible, firstInaccessiblePostTime: -1 },
    page([rootId], true),
  ])
    await expect(
      readThreadPage(
        { getPostThread: vi.fn().mockResolvedValue(invalid) },
        request,
      ),
    ).rejects.toThrow();
  await expect(
    readThreadPage(
      { getPostThread: vi.fn().mockResolvedValue(visible) },
      { ...request, cursor: { id: idA, createAt: 1000 } },
    ),
  ).rejects.toThrow();
});
test("validates the query before requesting the root", async () => {
  const api = { getPostThread: vi.fn() };
  for (const change of [
    { rootId: "bad" },
    { channelId: "" },
    { perPage: 201 },
    { perPage: 0 },
    { cursor: { id: idA, createAt: 0 } },
  ])
    await expect(
      readThreadPage(api, { ...request, ...change }),
    ).rejects.toThrow();
  expect(api.getPostThread).not.toHaveBeenCalled();
});
test.each(["abort", "close"] as const)(
  "discards an in-flight page on %s",
  async (action) => {
    vi.mocked(invoke).mockResolvedValueOnce(21);
    const account = await openAccountRestConnection(
      "https://fixture.test",
      "u".repeat(26),
    );
    const controller = new AbortController();
    let resolve!: (value: PostList) => void;
    const promise = new Promise<PostList>((done) => {
      resolve = done;
    });
    const reason = new Error("left thread");
    vi.spyOn(PostsApi.prototype, "getPostThread").mockReturnValueOnce(promise);
    const reading = account.readThreadPage(request, controller.signal);
    if (action === "close") await account.close();
    else void promise.then(() => controller.abort(reason));
    resolve(page([rootId]));
    await expect(reading).rejects.toBe(
      action === "close" ? "cancelled" : reason,
    );
  },
);

test("rejects backward continuations, reversed replies and an impossible root-only page", async () => {
  const flat = { ...request, collapsedThreads: false };
  for (const [query, data] of [
    [{ ...flat, perPage: 3 }, page([rootId], true)],
    [
      { ...flat, perPage: 1, cursor: { id: idA, createAt: 1100 } },
      page([rootId], true),
    ],
    [
      { ...request, cursor: { id: idB, createAt: 1000 } },
      page([rootId, idA], true),
    ],
    [request, page([rootId, idB, idA], false)],
  ] as const) {
    await expect(
      readThreadPage({ getPostThread: vi.fn().mockResolvedValue(data) }, query),
    ).rejects.toThrow();
  }
});
