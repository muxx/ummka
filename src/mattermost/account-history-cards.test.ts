import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, test, vi } from "vitest";
import { PostsApi } from "../../vendor/mattermost/index.js";
import { openPostNavigation } from "../channels/post-navigation.ts";
import { openThreadReplyWindow } from "../channels/thread-reply-window.ts";
import { openAccountRestConnection } from "./native-rest.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});

const channelId = "c".repeat(26);
const rootId = "r".repeat(26);
const replyId = "p".repeat(26);
const userId = "u".repeat(26);
const scope = { channelId, rootId, collapsedThreads: true };
const cards = (title: string) => [{ title, fields: [] }];
const snapshot = (title: string, updateAt: number, dispatch: number) => ({
  updateAt,
  dispatch,
  cards: title ? cards(title) : [],
});

function post(id: string, title: string, updateAt = 20) {
  return {
    id,
    channelId,
    rootId: id === rootId ? "" : rootId,
    userId,
    createAt: id === rootId ? 5 : 10,
    updateAt,
    editAt: 0,
    deleteAt: 0,
    isPinned: false,
    type: "",
    message: "original body",
    hashtags: "",
    props: { attachments: [{ title }] },
    metadata: { embeds: [{ type: "message_attachment" as const }] },
  };
}

function reader() {
  vi.mocked(invoke).mockResolvedValueOnce(17);
  return openAccountRestConnection("https://cards.example.test", userId);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("one thread commit delivers the accepted root and reply cards instead of the delayed REST observation", async () => {
  const account = await reader();
  const native = vi.mocked(invoke);
  const current = snapshot("current root", 30, 2);
  native
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce({ kind: "cached", changed: true, cards: current })
    .mockResolvedValueOnce({
      kind: "thread",
      cards: [current, snapshot("", 20, 2)],
    });
  const started = deferred<void>();
  const delayed = deferred<{
    order: string[];
    posts: Record<string, ReturnType<typeof post>>;
    hasNext: boolean;
  }>();
  vi.spyOn(PostsApi.prototype, "getPostThread").mockImplementationOnce(() => {
    started.resolve();
    return delayed.promise;
  });
  vi.spyOn(PostsApi.prototype, "getPost").mockResolvedValueOnce(
    post(rootId, "current root", 30),
  );
  const window = openThreadReplyWindow(account, scope);
  const loading = window.open();
  await started.promise;
  expect((await account.readPostAnchor(rootId)).post?.cards).toEqual(
    cards("current root"),
  );
  delayed.resolve({
    order: [rootId, replyId],
    posts: {
      [rootId]: post(rootId, "stale root"),
      [replyId]: post(replyId, "stale reply"),
    },
    hasNext: false,
  });
  await loading;
  expect(window.getSnapshot().root?.cards).toEqual(cards("current root"));
  expect(window.getSnapshot().replies[0].cards).toEqual([]);
  expect(native.mock.calls.map(([cmd]) => cmd)).toEqual([
    "open_rest_connection",
    "begin_channel_history_load",
    "begin_cached_post_observation",
    "finish_cached_post_observation",
    "store_channel_history_page",
  ]);
  window.close();
});

test("a point GET reads the committed cards even when its own observation lost", async () => {
  const account = await reader();
  vi.mocked(invoke)
    .mockResolvedValueOnce(21)
    .mockResolvedValueOnce({
      kind: "cached",
      changed: false,
      cards: snapshot("new thread content", 30, 9),
    });
  vi.spyOn(PostsApi.prototype, "getPost").mockResolvedValueOnce(
    post(rootId, "old point content"),
  );
  expect((await account.readPostAnchor(rootId)).post).toMatchObject({
    updateAt: 20,
    message: "original body",
    cards: cards("new thread content"),
  });
});

test("a known anchor removed in flight is unavailable and an uncached anchor still uses REST", async () => {
  const account = await reader();
  const native = vi.mocked(invoke);
  native
    .mockResolvedValueOnce(21)
    .mockResolvedValueOnce({ kind: "unavailable" })
    .mockResolvedValueOnce(22)
    .mockResolvedValueOnce({ kind: "uncached" });
  vi.spyOn(PostsApi.prototype, "getPost").mockResolvedValue(
    post(rootId, "only in REST"),
  );
  expect(await account.readPostAnchor(rootId)).toEqual({
    postId: rootId,
    channelId,
    post: null,
  });
  expect((await account.readPostAnchor(rootId)).post?.cards).toEqual(
    cards("only in REST"),
  );
  expect(native.mock.calls.map(([cmd]) => cmd)).toEqual([
    "open_rest_connection",
    "begin_cached_post_observation",
    "finish_cached_post_observation",
    "begin_cached_post_observation",
    "finish_cached_post_observation",
  ]);
});

test("a superseded anchor cancels navigation without declaring an unrelated post unavailable", async () => {
  const account = await reader();
  const teamId = "t".repeat(26);
  vi.mocked(invoke)
    .mockResolvedValueOnce(21)
    .mockResolvedValueOnce({ kind: "superseded" })
    .mockResolvedValueOnce(22)
    .mockResolvedValueOnce({ kind: "uncached" });
  vi.spyOn(PostsApi.prototype, "getPost").mockResolvedValue(
    post(rootId, "still available"),
  );
  const connection = {
    ...account,
    readPostDestination: async () => ({
      postId: rootId,
      channel: {
        id: channelId,
        kind: "O" as const,
        displayName: "Releases",
        joined: true,
      },
      team: {
        id: teamId,
        kind: "O" as const,
        displayName: "Fixture",
        joined: true,
      },
    }),
  };
  const confirm = vi.fn();
  const navigate = () =>
    openPostNavigation(
      connection,
      { kind: "post", id: rootId },
      teamId,
      confirm,
    ).open();
  expect(await navigate()).toEqual({
    target: { kind: "cancelled" },
    joined: [],
  });
  expect(await navigate()).toMatchObject({
    target: { kind: "ready", post: { cards: cards("still available") } },
    joined: [],
  });
  expect(confirm).not.toHaveBeenCalled();
});

test.each(["up", "down"] as const)(
  "the thread keeps the accepted version when the %s IPC response arrives first",
  async (first) => {
    const old = {
      ...post(rootId, "superseded", 40),
      cards: cards("old"),
      cardRevision: { updateAt: 40, dispatch: 1 },
    };
    const cleared = {
      ...post(rootId, "superseded", 20),
      cards: [],
      cardRevision: { updateAt: 40, dispatch: 2 },
    };
    const page = (root: typeof old) => ({
      kind: "page" as const,
      root,
      replies: [],
      next: null,
    });
    const up = deferred<ReturnType<typeof page>>();
    const down = deferred<ReturnType<typeof page>>();
    const window = openThreadReplyWindow(
      {
        readThreadPage: (query) =>
          query.direction === "up" ? up.promise : down.promise,
      },
      scope,
      { userId, lastViewedAt: 8 },
    );
    const loading = window.open();
    if (first === "up") {
      up.resolve(page(old));
      await window.more("up");
      down.resolve(page(cleared));
    } else {
      down.resolve(page(cleared));
      await window.more("down");
      up.resolve(page(old));
    }
    await loading;
    expect(window.getSnapshot().root).toMatchObject({
      updateAt: 40,
      cards: [],
    });
    window.close();
  },
);
