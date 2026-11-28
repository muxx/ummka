import { expect, test, vi } from "vitest";
import {
  Configuration,
  PostsApi,
  ResponseError,
} from "../../vendor/mattermost/index.js";
import type { ChannelPostChange } from "../mattermost/account-channel-events.ts";
import { refreshChannelHistory } from "../mattermost/channel-history-refresh.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import { applyOpenChannelEvents } from "./open-channel-events.ts";

const id = (s: string) => s.repeat(26);
const channelId = id("c"),
  rootId = id("r"),
  postId = id("p");
const opened = {
  channelId,
  collapsedThreads: true,
  page: null,
  visibleIds: [],
  thread: null,
};
const signal = new AbortController().signal;
const change = (
  kind: ChannelPostChange["kind"],
  post = postId,
  root: string | null = null,
): ChannelPostChange => ({ kind, postId: post, rootId: root, channelId });
function account() {
  return {
    refreshChannelHistory: vi
      .fn<
        Parameters<typeof applyOpenChannelEvents>[0]["refreshChannelHistory"]
      >()
      .mockResolvedValue({ kind: "applied" }),
    applyChannelPostEvents: vi
      .fn<
        Parameters<typeof applyOpenChannelEvents>[0]["applyChannelPostEvents"]
      >()
      .mockResolvedValue({ result: { kind: "applied" }, changes: [] }),
    readSavedPost: vi
      .fn<Parameters<typeof applyOpenChannelEvents>[0]["readSavedPost"]>()
      .mockResolvedValue(null),
  };
}
test("a group of new IDs in an empty open channel reads a single real page in the selected mode", async () => {
  const a = account();
  const batch = [
    change("created"),
    change("created"),
    change("created", rootId),
    { ...change("created"), channelId: id("x") },
  ];
  await applyOpenChannelEvents(
    a,
    opened,
    { kind: "posts", changes: batch },
    signal,
  );
  expect(a.refreshChannelHistory.mock.calls).toEqual([
    [{ kind: "latest", channelId, collapsedThreads: true }, signal],
  ]);
  expect(a.applyChannelPostEvents).not.toHaveBeenCalled();
});
test("CRT refreshes a visible root once whereas the flat stream refreshes its latest page", async () => {
  const a = account(),
    batch = {
      kind: "posts" as const,
      changes: [
        change("created", postId, rootId),
        change("created", id("q"), rootId),
      ],
    };
  await applyOpenChannelEvents(
    a,
    { ...opened, visibleIds: [rootId] },
    batch,
    signal,
  );
  expect(a.refreshChannelHistory.mock.calls.map(([q]) => q)).toEqual([
    {
      kind: "focused",
      channelId,
      collapsedThreads: true,
      postId: rootId,
      perPage: 1,
    },
  ]);
  a.refreshChannelHistory.mockClear();
  await applyOpenChannelEvents(
    a,
    { ...opened, collapsedThreads: false },
    batch,
    signal,
  );
  expect(a.refreshChannelHistory.mock.calls.map(([q]) => q.kind)).toEqual([
    "latest",
  ]);
});
test("a final deletion wins over an earlier create and stale edit of the same ID", async () => {
  const a = account();
  await applyOpenChannelEvents(
    a,
    opened,
    {
      kind: "posts",
      changes: [change("created"), change("deleted"), change("edited")],
    },
    signal,
  );
  expect(a.applyChannelPostEvents.mock.calls).toEqual([
    [channelId, [change("deleted")], signal],
  ]);
  expect(a.refreshChannelHistory).not.toHaveBeenCalled();
});
test("other channels do not touch the account and unknown edits cannot populate the stored timeline", async () => {
  const a = account();
  await applyOpenChannelEvents(
    a,
    opened,
    { kind: "posts", changes: [{ ...change("edited"), channelId: id("x") }] },
    signal,
  );
  expect(a.readSavedPost).not.toHaveBeenCalled();
  await applyOpenChannelEvents(
    a,
    opened,
    { kind: "posts", changes: [change("edited")] },
    signal,
  );
  expect(a.readSavedPost).toHaveBeenCalledWith(channelId, postId);
  expect(a.applyChannelPostEvents).not.toHaveBeenCalled();
});
test("replacing the server queue reconciles the live end and changes since the oldest visible version", async () => {
  const a = account();
  const rows = [
    { id: rootId, updateAt: 180 },
    { id: postId, updateAt: 100 },
    { id: id("x"), updateAt: 50 },
  ] as LocalPost[];
  await applyOpenChannelEvents(
    a,
    {
      ...opened,
      visibleIds: [rootId, postId],
      page: {
        posts: rows,
        newer: { kind: "more", postId },
        older: { kind: "end" },
        firstInaccessiblePostTime: 0,
      },
    },
    { kind: "reconcile" },
    signal,
  );
  expect(a.refreshChannelHistory.mock.calls.map(([q]) => q)).toEqual([
    { kind: "latest", channelId, collapsedThreads: true },
    { kind: "since", channelId, collapsedThreads: true, since: 99 },
  ]);
});
test("superseded local permits are retried before acknowledging delivery", async () => {
  const a = account();
  a.refreshChannelHistory.mockResolvedValueOnce({ kind: "superseded" });
  await expect(
    applyOpenChannelEvents(
      a,
      opened,
      { kind: "posts", changes: [change("created")] },
      signal,
    ),
  ).resolves.toBeUndefined();
  expect(a.refreshChannelHistory).toHaveBeenCalledTimes(2);
  a.applyChannelPostEvents.mockResolvedValueOnce({
    result: { kind: "superseded" },
    changes: [],
  });
  await expect(
    applyOpenChannelEvents(
      a,
      opened,
      { kind: "posts", changes: [change("deleted")] },
      signal,
    ),
  ).resolves.toBeUndefined();
  expect(a.applyChannelPostEvents).toHaveBeenCalledTimes(2);
});

test("a persistently superseded write leaves the group unconfirmed after one fresh permit", async () => {
  const a = account();
  a.refreshChannelHistory.mockResolvedValue({ kind: "superseded" });
  await expect(
    applyOpenChannelEvents(
      a,
      opened,
      { kind: "posts", changes: [change("created")] },
      signal,
    ),
  ).rejects.toThrow("superseded");
  expect(a.refreshChannelHistory).toHaveBeenCalledTimes(2);
});

test("a denied channel read withdraws its open content and a rejected session is reported to the owner", async () => {
  const a = account(),
    batch = { kind: "posts" as const, changes: [change("created")] };
  a.refreshChannelHistory.mockRejectedValueOnce(
    new ResponseError(new Response(null, { status: 403 })),
  );
  expect(await applyOpenChannelEvents(a, opened, batch, signal)).toBe(
    "forbidden",
  );
  a.refreshChannelHistory.mockRejectedValueOnce(
    new ResponseError(new Response(null, { status: 401 })),
  );
  await expect(
    applyOpenChannelEvents(a, opened, batch, signal),
  ).rejects.toMatchObject({ response: { status: 401 } });
  const closed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("The response body closed"));
    },
  });
  a.applyChannelPostEvents.mockRejectedValueOnce(
    new ResponseError(new Response(closed, { status: 403 })),
  );
  expect(
    await applyOpenChannelEvents(
      a,
      { ...opened, visibleIds: [postId] },
      { kind: "posts", changes: [change("edited")] },
      signal,
    ),
  ).toBe("forbidden");
});

test.each([403, 404])(
  "a denied history page still closes the channel when its HTTP body is aborted (%s)",
  async (status) => {
    const a = account();
    const cancelled = vi.fn(async () => {});
    const api = new PostsApi(
      new Configuration({
        basePath: "https://example.test/api/v4",
        fetchApi: async (_input, init) => {
          const attempt = init?.signal;
          if (!attempt) throw Error("The signed read did not bind a signal");
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              attempt.addEventListener(
                "abort",
                () => controller.error(attempt.reason),
                { once: true },
              );
            },
          });
          return new Response(body, { status });
        },
      }),
    );
    a.refreshChannelHistory.mockImplementation((req, signal) =>
      refreshChannelHistory(
        api,
        { begin: async () => 1, cancel: cancelled, store: vi.fn() },
        req,
        signal,
      ),
    );
    expect(
      await applyOpenChannelEvents(
        a,
        opened,
        { kind: "posts", changes: [change("created")] },
        signal,
      ),
    ).toBe("forbidden");
    expect(cancelled).toHaveBeenCalledOnce();
  },
);
