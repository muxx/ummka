import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, test, vi } from "vitest";
import {
  Configuration,
  ResponseError,
  ThreadsApi,
  type UserThreads,
} from "../../vendor/mattermost/index.js";
import { accountFollowedThreads } from "./account-followed-threads.ts";
import { openAccountRestConnection } from "./native-rest.ts";

const team = "t".repeat(26),
  channel = "c".repeat(26),
  user = "u".repeat(26);
const first = "a".repeat(26),
  second = "b".repeat(26),
  before = "z".repeat(26);
const query = { teamId: team, unread: false };
const zero = {
  total: 0,
  total_unread_threads: 0,
  total_unread_mentions: 0,
  total_unread_urgent_mentions: 0,
};
function thread(id: string, time = 73) {
  return {
    id,
    reply_count: 0,
    unread_replies: 0,
    unread_mentions: 0,
    last_reply_at: time,
    last_viewed_at: 0,
    delete_at: 0,
    is_urgent: false,
    participants: [{ id: user, username: "fixture" }],
    post: {
      id,
      user_id: user,
      channel_id: channel,
      root_id: "",
      message: "",
      type: "",
      create_at: 70,
      update_at: 70,
      edit_at: 0,
      delete_at: 0,
      hashtags: "",
      is_pinned: false,
    },
  };
}
function fixture() {
  const fetchApi = vi.fn<typeof fetch>();
  const account = accountFollowedThreads(
    new Configuration({ basePath: "https://example.test/sub", fetchApi }),
    (read) => read(),
  );
  return { fetchApi, account };
}
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});

test("reads one signed page in server order, including ties, zero activity and an empty visible message", async () => {
  const { fetchApi, account } = fixture();
  const signal = new AbortController().signal;
  fetchApi.mockResolvedValueOnce(
    Response.json({ ...zero, threads: [thread(first, 0), thread(second, 0)] }),
  );
  const page = await account.readFollowedThreads(
    { ...query, unread: true, before, perPage: 2 },
    signal,
  );
  expect(page.items.map((item) => item.id)).toEqual([first, second]);
  expect(page.nextBefore).toBe(second);
  expect(page.items[0]).toMatchObject({
    id: first,
    post: { id: first, channelId: channel, rootId: null, message: "" },
    participantIds: [user],
    lastReplyAt: 0,
    unreadReplies: 0,
  });
  expect(page).not.toHaveProperty("total");
  const [input, init] = fetchApi.mock.calls[0];
  const url = new URL(String(input));
  expect(url.pathname).toBe(`/sub/api/v4/users/me/teams/${team}/threads`);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    before,
    per_page: "2",
    extended: "true",
    threadsOnly: "true",
    unread: "true",
  });
  expect(init).toMatchObject({ method: "GET", signal });
  fetchApi.mockResolvedValueOnce(Response.json({ ...zero, threads: [] }));
  expect(
    await account.readFollowedThreads({ ...query, before: second }),
  ).toEqual({ items: [], nextBefore: null });
  expect(
    new URL(String(fetchApi.mock.calls[1][0])).searchParams.get("per_page"),
  ).toBe("25");
});
test("keeps missing or deleted root content unavailable without losing its cursor or the next row", async () => {
  const { fetchApi, account } = fixture();
  const root = thread(first);
  for (const changed of [
    { ...root, post: null },
    { ...root, delete_at: 95, post: { ...root.post, message: "old" } },
    { ...root, post: { ...root.post, message: "old", delete_at: 95 } },
  ]) {
    fetchApi.mockResolvedValueOnce(
      Response.json({ ...zero, threads: [changed, thread(second, 38)] }),
    );
    const page = await account.readFollowedThreads(query);
    expect(page.items[0].post).toBeNull();
    expect(page.items[1].post?.id).toBe(second);
    expect(page.nextBefore).toBeNull();
    expect(page.items[0].participantIds).toEqual([user]);
  }
});
test("reads all four real totals with no unread filter and distinguishes a zero total from a page", async () => {
  const { fetchApi, account } = fixture();
  const raw = {
    total: 38,
    total_unread_threads: 7,
    total_unread_mentions: 23,
    total_unread_urgent_mentions: 4,
  };
  fetchApi.mockResolvedValueOnce(Response.json({ ...raw, threads: null }));
  expect(await account.readFollowedThreadTotals(team)).toEqual({
    total: 38,
    totalUnreadThreads: 7,
    totalUnreadMentions: 23,
    totalUnreadUrgentMentions: 4,
  });
  expect(
    Object.fromEntries(new URL(String(fetchApi.mock.calls[0][0])).searchParams),
  ).toEqual({ totalsOnly: "true" });
  fetchApi.mockResolvedValueOnce(Response.json({ ...zero, threads: null }));
  expect((await account.readFollowedThreadTotals(team)).total).toBe(0);
  for (const value of [
    { ...raw, threads: [] },
    { ...raw, threads: null, total: -1 },
    { ...raw, threads: null, total_unread_mentions: 0.5 },
    { ...raw, threads: null, total_unread_threads: null },
  ]) {
    fetchApi.mockResolvedValueOnce(Response.json(value));
    await expect(account.readFollowedThreadTotals(team)).rejects.toThrow(
      TypeError,
    );
  }
});
test("rejects a broken page instead of returning its valid prefix", async () => {
  const { fetchApi, account } = fixture(),
    a = thread(first),
    b = thread(second);
  for (const threads of [
    [a, a],
    [a, { ...b, id: before }],
    [a, thread(second, 100)],
    [a, { ...b, participants: [{ id: "broken" }] }],
    [a, { ...b, unread_replies: -1 }],
    [a, { ...b, reply_count: null }],
    [a, { ...b, is_urgent: "true" }],
    [a, { ...b, post: { ...b.post, id: first } }],
    [a, { ...b, post: { ...b.post, root_id: first } }],
    [a, { ...b, post: { ...b.post, channel_id: "" } }],
    [a, { ...b, post: { ...b.post, user_id: "bad" } }],
    null,
  ]) {
    fetchApi.mockResolvedValueOnce(Response.json({ ...zero, threads }));
    await expect(
      account.readFollowedThreads({ ...query, before }),
    ).rejects.toThrow(TypeError);
  }
  fetchApi.mockResolvedValueOnce(Response.json({ ...zero, threads: [a, b] }));
  await expect(
    account.readFollowedThreads({ ...query, perPage: 1 }),
  ).rejects.toThrow(TypeError);
});
test("refuses invalid inputs before transport and passes server and network errors through", async () => {
  const { fetchApi, account } = fixture();
  for (const changed of [
    { teamId: "fake" },
    { before: "" },
    { perPage: 0 },
    { perPage: 201 },
    { perPage: 1.5 },
  ]) {
    await expect(
      account.readFollowedThreads({ ...query, ...changed }),
    ).rejects.toThrow();
  }
  await expect(account.readFollowedThreadTotals("fake")).rejects.toThrow(
    TypeError,
  );
  const controller = new AbortController();
  controller.abort(new Error("Changed team"));
  await expect(
    account.readFollowedThreads(query, controller.signal),
  ).rejects.toBe(controller.signal.reason);
  await expect(
    account.readFollowedThreadTotals(team, controller.signal),
  ).rejects.toBe(controller.signal.reason);
  expect(fetchApi).not.toHaveBeenCalled();
  fetchApi.mockResolvedValueOnce(new Response("", { status: 403 }));
  await expect(account.readFollowedThreads(query)).rejects.toBeInstanceOf(
    ResponseError,
  );
  const offline = new Error("offline");
  vi.spyOn(ThreadsApi.prototype, "getUserThreads").mockRejectedValueOnce(
    offline,
  );
  await expect(account.readFollowedThreadTotals(team)).rejects.toBe(offline);
});
test.each(["page", "totals"] as const)(
  "an aborted or closed account cannot publish a late %s",
  async (kind) => {
    for (const closed of [true, false]) {
      vi.mocked(invoke).mockResolvedValueOnce(41);
      const account = await openAccountRestConnection(
        "https://example.test/sub",
        user,
      );
      const controller = new AbortController(),
        signal = controller.signal;
      let finish!: (result: UserThreads) => void;
      const pending = new Promise<UserThreads>((resolve) => {
        finish = resolve;
      });
      vi.spyOn(ThreadsApi.prototype, "getUserThreads").mockReturnValueOnce(
        pending,
      );
      const read =
        kind === "page"
          ? account.readFollowedThreads(query, signal)
          : account.readFollowedThreadTotals(team, signal);
      if (closed) await account.close();
      else controller.abort(new Error("Left list"));
      finish({
        threads: kind === "page" ? [] : null,
        total: 0,
        totalUnreadThreads: 0,
        totalUnreadMentions: 0,
        totalUnreadUrgentMentions: 0,
      });
      await expect(read).rejects.toBe(closed ? "cancelled" : signal.reason);
      if (!closed) await account.close();
      await expect(account.readFollowedThreads(query)).rejects.toBe(
        "unknown_connection",
      );
    }
  },
);

test("keeps thread-list display fields separate from a complete integration-card observation", async () => {
  const { account, fetchApi } = fixture();
  const raw = thread(first);
  fetchApi.mockResolvedValueOnce(
    Response.json({
      ...zero,
      threads: [
        {
          ...raw,
          post: {
            ...raw.post,
            props: {
              attachments: [
                { title: "Published check", context: "secret" },
                { text: "**Second** result" },
                null,
              ],
            },
            file_ids: [second],
          },
        },
      ],
    }),
  );
  const { items } = await account.readFollowedThreads(query);
  expect(items[0].post?.excerptCards).toEqual([
    { title: "Published check" },
    { text: "**Second** result" },
  ]);
  expect(items[0].post?.cards).toBeUndefined();
  expect(items[0].post?.attachments).toEqual({ fileIds: [second] });
  expect(fetchApi).toHaveBeenCalledTimes(1);
});
