import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, test, vi } from "vitest";
import {
  Configuration,
  FetchError,
  ResponseError,
  ThreadsApi,
  UserThreadFromJSON,
} from "../../vendor/mattermost/index.js";
import { accountFollowedThreads } from "./account-followed-threads.ts";
import { openAccountRestConnection } from "./native-rest.ts";

const target = {
  teamId: "t".repeat(26),
  channelId: "c".repeat(26),
  rootId: "r".repeat(26),
};
const other = "x".repeat(26);
const post = {
  id: target.rootId,
  channel_id: target.channelId,
  root_id: "",
  delete_at: 0,
};
const wire = {
  id: target.rootId,
  delete_at: 0,
  last_viewed_at: 1700000000000,
  unread_replies: 0,
  unread_mentions: 1,
  post,
};
const basePath = "https://example.test/sub";

function fixture() {
  const fetchApi = vi.fn<typeof fetch>();
  const account = accountFollowedThreads(
    new Configuration({ basePath, fetchApi }),
    (read) => read(),
  );
  return { account, fetchApi };
}

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});

test("reads one confirmed root for me under the installation prefix with no query", async () => {
  const { account, fetchApi } = fixture();
  const signal = new AbortController().signal;
  fetchApi.mockResolvedValueOnce(Response.json(wire));
  expect(await account.readFollowedThreadState(target, signal)).toEqual({
    id: target.rootId,
    following: true,
    lastViewedAt: wire.last_viewed_at,
    unreadReplies: 0,
    unreadMentions: 1,
  });
  expect(fetchApi).toHaveBeenCalledExactlyOnceWith(
    `${basePath}/api/v4/users/me/teams/${target.teamId}/threads/${target.rootId}`,
    expect.objectContaining({ method: "GET", signal }),
  );
  expect(fetchApi.mock.calls[0]?.[1]?.body).toBeUndefined();
});

test("declines invalid full IDs and pre-abort before starting HTTP", async () => {
  const { account, fetchApi } = fixture();
  for (const key of ["teamId", "channelId", "rootId"] as const)
    await expect(
      account.readFollowedThreadState({ ...target, [key]: "short" }),
    ).rejects.toThrow(TypeError);
  const signal = AbortSignal.abort(new Error("Left thread"));
  await expect(account.readFollowedThreadState(target, signal)).rejects.toBe(
    signal.reason,
  );
  expect(fetchApi).not.toHaveBeenCalled();
});

test.each([
  ["unexpected success status", wire, 202],
  ["another thread", { ...wire, id: other }, 200],
  ["another root", { ...wire, post: { ...post, id: other } }, 200],
  ["another channel", { ...wire, post: { ...post, channel_id: other } }, 200],
  ["reply", { ...wire, post: { ...post, root_id: other } }, 200],
  ["deleted thread with an active root", { ...wire, delete_at: 1 }, 200],
  ["deleted root", { ...wire, post: { ...post, delete_at: 1 } }, 200],
  ["missing thread deletion state", { ...wire, delete_at: undefined }, 200],
  ["no root", { ...wire, post: null }, 200],
  [
    "incomplete root",
    { ...wire, post: { id: post.id, channel_id: post.channel_id } },
    200,
  ],
  [
    "missing root deletion state",
    { ...wire, post: { ...post, delete_at: undefined } },
    200,
  ],
  [
    "missing root type",
    { ...wire, post: { ...post, root_id: undefined } },
    200,
  ],
  ["negative count", { ...wire, unread_replies: -1 }, 200],
  ["fractional count", { ...wire, unread_mentions: 1.5 }, 200],
  ["missing count", { ...wire, unread_mentions: undefined }, 200],
  [
    "unrepresentable time",
    { ...wire, last_viewed_at: Number.MAX_SAFE_INTEGER + 1 },
    200,
  ],
] as const)(
  "rejects a %s in the receipt without retry",
  async (_, body, status) => {
    const { account, fetchApi } = fixture();
    fetchApi.mockResolvedValueOnce(Response.json(body, { status }));
    await expect(account.readFollowedThreadState(target)).rejects.toThrow(
      TypeError,
    );
    expect(fetchApi).toHaveBeenCalledTimes(1);
  },
);

test("preserves 403, both 404 bodies and a lost response without retry", async () => {
  const { account, fetchApi } = fixture();
  for (const [status, id] of [
    [403, "api.context.permissions.app_error"],
    [404, "app.user.get_thread_membership_for_user.not_found"],
    [404, "app.user.get_threads_for_user.not_found"],
  ] as const) {
    const response = Response.json({ id }, { status });
    fetchApi.mockResolvedValueOnce(response);
    const error = await account
      .readFollowedThreadState(target)
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ResponseError);
    expect(error).toMatchObject({ response });
    expect(await response.json()).toEqual({ id });
  }
  const lost = new TypeError("Disconnected");
  fetchApi.mockRejectedValueOnce(lost);
  await expect(account.readFollowedThreadState(target)).rejects.toMatchObject({
    name: FetchError.name,
    cause: lost,
  });
  expect(fetchApi).toHaveBeenCalledTimes(4);
});

test.each(["abort", "close"] as const)(
  "an account discards a response after %s during body decoding",
  async (action) => {
    vi.mocked(invoke).mockResolvedValueOnce(41);
    const account = await openAccountRestConnection(basePath, "u".repeat(26));
    const controller = new AbortController();
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const remaining = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const raw = vi
      .spyOn(ThreadsApi.prototype, "getUserThreadRaw")
      .mockResolvedValue({
        raw: new Response(),
        value: async () => {
          started();
          await remaining;
          return UserThreadFromJSON(wire);
        },
      });
    const request = account.readFollowedThreadState(target, controller.signal);
    await reading;
    if (action === "close") await account.close();
    else controller.abort(new Error("Left account"));
    finish();
    await expect(request).rejects.toBe(
      action === "close" ? "cancelled" : controller.signal.reason,
    );
    if (action === "close")
      await expect(account.readFollowedThreadState(target)).rejects.toBe(
        "unknown_connection",
      );
    else await account.close();
    expect(raw).toHaveBeenCalledTimes(1);
  },
);
