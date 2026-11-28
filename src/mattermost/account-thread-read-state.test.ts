import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, test, vi } from "vitest";
import {
  Configuration,
  FetchError,
  ResponseError,
  ThreadsApi,
} from "../../vendor/mattermost/index.js";
import { accountFollowedThreads } from "./account-followed-threads.ts";
import { openAccountRestConnection } from "./native-rest.ts";

const team = "t".repeat(26),
  thread = "r".repeat(26),
  reply = "p".repeat(26),
  user = "u".repeat(26);
const timestamp = 1_700_000_000_000;
const wire = {
  id: thread,
  last_viewed_at: timestamp,
  unread_replies: 0,
  unread_mentions: 1,
};
function fixture() {
  const fetchApi = vi.fn<typeof fetch>();
  const account = accountFollowedThreads(
    new Configuration({ basePath: "https://example.test/sub", fetchApi }),
    (read) => read(),
  );
  return { account, fetchApi };
}
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});

test("confirms an individual read through the exact timestamp without subtracting a mention or fetching team totals", async () => {
  const { account, fetchApi } = fixture();
  fetchApi.mockResolvedValueOnce(
    Response.json({ ...wire, participants: [], post: { id: thread } }),
  );
  const signal = new AbortController().signal;
  expect(
    await account.markFollowedThreadRead(team, thread, timestamp, signal),
  ).toEqual({
    id: thread,
    lastViewedAt: timestamp,
    unreadReplies: 0,
    unreadMentions: 1,
  });
  expect(fetchApi).toHaveBeenCalledTimes(1);
  expect(fetchApi.mock.calls[0]).toEqual([
    `https://example.test/sub/api/v4/users/me/teams/${team}/threads/${thread}/read/${timestamp}`,
    expect.objectContaining({ method: "PUT", signal }),
  ]);
  expect(fetchApi.mock.calls[0]?.[1]?.body).toBeUndefined();
});
test("marking all threads confirms the server status; a separate totals read can observe another unread reply", async () => {
  const { account, fetchApi } = fixture();
  fetchApi.mockResolvedValueOnce(Response.json({ status: "OK" }));
  await account.markTeamThreadsRead(team);
  expect(fetchApi).toHaveBeenCalledTimes(1);
  expect(fetchApi.mock.calls[0]?.[0]).toBe(
    `https://example.test/sub/api/v4/users/me/teams/${team}/threads/read`,
  );
  fetchApi.mockResolvedValueOnce(
    Response.json({
      threads: null,
      total: 3,
      total_unread_threads: 1,
      total_unread_mentions: 1,
      total_unread_urgent_mentions: 0,
    }),
  );
  expect(await account.readFollowedThreadTotals(team)).toMatchObject({
    total: 3,
    totalUnreadThreads: 1,
    totalUnreadMentions: 1,
  });
});
test("rejects absent or mismatched server confirmation for a thread without another write", async () => {
  for (const [body, status] of [
    [wire, 202],
    [{ ...wire, id: user }, 200],
    [{ ...wire, last_viewed_at: timestamp - 1 }, 200],
    [{ ...wire, unread_replies: -1 }, 200],
    [{ ...wire, unread_mentions: 1.5 }, 200],
    [{}, 200],
  ] as const) {
    const { account, fetchApi } = fixture();
    fetchApi.mockResolvedValueOnce(Response.json(body, { status }));
    await expect(
      account.markFollowedThreadRead(team, thread, timestamp),
    ).rejects.toThrow();
    expect(fetchApi).toHaveBeenCalledTimes(1);
  }
});
test("does not confirm an incomplete team acknowledgement or retry a refused request", async () => {
  const { account, fetchApi } = fixture();
  for (const [body, status] of [
    [{ status: "OK" }, 201],
    [{ status: "ok" }, 200],
    [{}, 200],
  ] as const) {
    fetchApi.mockResolvedValueOnce(Response.json(body, { status }));
    await expect(account.markTeamThreadsRead(team)).rejects.toThrow();
  }
  fetchApi.mockResolvedValueOnce(new Response("", { status: 403 }));
  await expect(
    account.markFollowedThreadRead(team, thread, timestamp),
  ).rejects.toBeInstanceOf(ResponseError);
  fetchApi.mockRejectedValueOnce(new TypeError("offline"));
  await expect(account.markTeamThreadsRead(team)).rejects.toThrow();
  expect(fetchApi).toHaveBeenCalledTimes(5);
});
test("validates team, thread and precise positive time before dispatch, including a pre-aborted action", async () => {
  const { account, fetchApi } = fixture();
  for (const t of [0, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await expect(
      account.markFollowedThreadRead(team, thread, t),
    ).rejects.toThrow();
  await expect(
    account.markFollowedThreadRead(team, "wrong", timestamp),
  ).rejects.toThrow();
  await expect(account.markTeamThreadsRead("wrong")).rejects.toThrow();
  const signal = AbortSignal.abort(new Error("left team"));
  await expect(
    account.markFollowedThreadRead(team, thread, timestamp, signal),
  ).rejects.toBe(signal.reason);
  await expect(account.markTeamThreadsRead(team, signal)).rejects.toBe(
    signal.reason,
  );
  expect(fetchApi).not.toHaveBeenCalled();
});
test.each([
  { id: thread, rootId: null },
  { id: reply, rootId: thread },
])(
  "marks unread from the selected post and keeps the confirmed server boundary ($id)",
  async (selected) => {
    const { account, fetchApi } = fixture();
    const signal = new AbortController().signal;
    const post = { ...selected, createAt: timestamp - 20 };
    fetchApi.mockResolvedValueOnce(
      Response.json({
        ...wire,
        last_viewed_at: timestamp - 1,
        unread_replies: 2,
        participants: [],
        post: { id: thread },
      }),
    );
    expect(await account.markThreadUnreadFromPost(team, post, signal)).toEqual({
      id: thread,
      lastViewedAt: timestamp - 1,
      unreadReplies: 2,
      unreadMentions: 1,
    });
    expect(fetchApi).toHaveBeenCalledExactlyOnceWith(
      `https://example.test/sub/api/v4/users/me/teams/${team}/threads/${thread}/set_unread/${post.id}`,
      expect.objectContaining({ method: "POST", signal }),
    );
    expect(fetchApi.mock.calls[0]?.[1]?.body).toBeUndefined();
  },
);

test("rejects invalid unread targets and caller cancellation before sending", async () => {
  const { account, fetchApi } = fixture();
  const post = { id: reply, rootId: thread };
  for (const [teamId, target] of [
    ["short", post],
    [team, { ...post, id: "short" }],
    [team, { ...post, rootId: "short" }],
    [team, { ...post, rootId: post.id }],
  ] as const) {
    await expect(
      account.markThreadUnreadFromPost(teamId, target),
    ).rejects.toThrow();
  }
  const signal = AbortSignal.abort(new Error("left account"));
  await expect(
    account.markThreadUnreadFromPost(team, post, signal),
  ).rejects.toBe(signal.reason);
  expect(fetchApi).not.toHaveBeenCalled();
});

test.each([
  [wire, 202],
  [{ ...wire, id: reply }, 200],
  [{ ...wire, last_viewed_at: -1 }, 200],
  [{ ...wire, unread_replies: -1 }, 200],
  [{ ...wire, unread_mentions: 1.5 }, 200],
  [{}, 200],
] as const)(
  "declines an invalid unread receipt and sends just one request (%j, HTTP %d)",
  async (body, status) => {
    const { account, fetchApi } = fixture();
    fetchApi.mockResolvedValueOnce(Response.json(body, { status }));
    await expect(
      account.markThreadUnreadFromPost(team, { id: reply, rootId: thread }),
    ).rejects.toThrow();
    expect(fetchApi).toHaveBeenCalledTimes(1);
  },
);

test("propagates a refused unread request and a lost receipt without retrying either", async () => {
  const { account, fetchApi } = fixture();
  const post = { id: reply, rootId: thread };
  fetchApi.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(
    account.markThreadUnreadFromPost(team, post),
  ).rejects.toBeInstanceOf(ResponseError);
  expect(fetchApi).toHaveBeenCalledTimes(1);

  const lost = new TypeError("connection ended after dispatch");
  fetchApi.mockRejectedValueOnce(lost);
  await expect(
    account.markThreadUnreadFromPost(team, post),
  ).rejects.toMatchObject({
    name: FetchError.name,
    cause: lost,
  });
  expect(fetchApi).toHaveBeenCalledTimes(2);
});

test.each(["single", "all", "unread"] as const)(
  "closed and aborted accounts discard a delayed %s read acknowledgement",
  async (kind) => {
    for (const closed of [true, false]) {
      vi.mocked(invoke).mockResolvedValueOnce(41);
      const account = await openAccountRestConnection(
        "https://example.test",
        user,
      );
      const controller = new AbortController();
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const one = vi
        .spyOn(
          ThreadsApi.prototype,
          kind === "unread"
            ? "setThreadUnreadByPostIdRaw"
            : "updateThreadReadForUserRaw",
        )
        .mockResolvedValue({
          raw: new Response(),
          value: async () => {
            await pending;
            return {
              id: thread,
              lastViewedAt: timestamp,
              unreadMentions: 1,
              unreadReplies: 0,
            };
          },
        });
      const all = vi
        .spyOn(ThreadsApi.prototype, "updateThreadsReadForUserRaw")
        .mockResolvedValue({
          raw: new Response(),
          value: async () => {
            await pending;
            return { status: "OK" };
          },
        });
      const request =
        kind === "single"
          ? account.markFollowedThreadRead(
              team,
              thread,
              timestamp,
              controller.signal,
            )
          : kind === "unread"
            ? account.markThreadUnreadFromPost(
                team,
                { id: reply, rootId: thread },
                controller.signal,
              )
            : account.markTeamThreadsRead(team, controller.signal);
      if (closed) await account.close();
      else controller.abort(new Error("left account"));
      finish();
      await expect(request).rejects.toBe(
        closed ? "cancelled" : controller.signal.reason,
      );
      if (closed && kind === "unread")
        await expect(
          account.markThreadUnreadFromPost(team, { id: reply, rootId: thread }),
        ).rejects.toBe("unknown_connection");
      expect(kind === "all" ? all : one).toHaveBeenCalledTimes(1);
      one.mockRestore();
      all.mockRestore();
      if (!closed) await account.close();
    }
  },
);
