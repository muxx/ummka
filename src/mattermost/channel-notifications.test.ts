import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, test, vi } from "vitest";
import {
  ChannelsApi,
  Configuration,
  ResponseError,
  UsersApi,
} from "../../vendor/mattermost/index.js";
import { readChannelNotifications } from "./channel-notifications.ts";
import { openAccountRestConnection } from "./native-rest.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});

const channelId = "c".repeat(26),
  userId = "u".repeat(26);
function server(
  host: string,
  profile: unknown,
  membership: unknown,
  memberStatus = 200,
) {
  const basePath = `https://${host}.example.test/site`;
  const fetchApi = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).toBe("GET");
    if (url === `${basePath}/api/v4/users/me`) return Response.json(profile);
    expect(url).toBe(`${basePath}/api/v4/channels/${channelId}/members/me`);
    return Response.json(membership, { status: memberStatus });
  });
  return { config: new Configuration({ basePath, fetchApi }), fetchApi };
}
const ownProfile = {
  id: userId,
  notify_props: {
    desktop: "mention",
    push_threads: "all",
    desktop_notification_sound: "Bing",
    mention_keys: "private-string",
  },
};
const ownMember = {
  user_id: userId,
  channel_id: channelId,
  notify_props: {
    desktop: "default",
    push: "none",
    channel_auto_follow_threads: "on",
    desktop_sound: "off",
  },
};

test("reads both scoped endpoints and keeps inheritance separate from the account defaults", async () => {
  const first = server("first", ownProfile, ownMember);
  const second = server(
    "second",
    { id: userId, notify_props: {} },
    { ...ownMember, notify_props: { push: "default" } },
  );
  const controller = new AbortController();
  const [one, two] = await Promise.all(
    [first, second].map(({ config }) =>
      readChannelNotifications(config, userId, channelId, controller.signal),
    ),
  );
  expect(one.account).toStrictEqual({
    desktop: "mention",
    pushThreads: "all",
    desktopNotificationSound: "Bing",
  });
  expect(one.channel).toStrictEqual({
    desktop: "default",
    push: "none",
    channelAutoFollowThreads: "on",
    desktopSound: "off",
  });
  expect(one.account).not.toHaveProperty("mentionKeys");
  expect(two.channel).toStrictEqual({ push: "default" });
  expect(two.account).toStrictEqual({});
  for (const mock of [first, second]) {
    expect(mock.fetchApi).toHaveBeenCalledTimes(2);
    for (const [, options] of mock.fetchApi.mock.calls)
      expect(options?.signal).toBe(controller.signal);
  }
});

test.each([
  [{ ...ownProfile, id: "x".repeat(26) }, ownMember],
  [ownProfile, { ...ownMember, user_id: "x".repeat(26) }],
  [ownProfile, { ...ownMember, channel_id: "x".repeat(26) }],
  [{ id: userId }, ownMember],
  [ownProfile, { ...ownMember, notify_props: null }],
  [{ ...ownProfile, notify_props: { push_threads: 4 } }, ownMember],
  [ownProfile, { ...ownMember, notify_props: { desktop_sound: false } }],
])("rejects incomplete, foreign or malformed results", async (user, member) => {
  const { config } = server("test", user, member);
  await expect(
    readChannelNotifications(config, userId, channelId),
  ).rejects.toBeInstanceOf(TypeError);
});

test("rejects invalid input before transport and preserves a refused membership", async () => {
  const { config, fetchApi } = server("test", ownProfile, {}, 403);
  await expect(
    readChannelNotifications(config, userId, "bad"),
  ).rejects.toBeInstanceOf(TypeError);
  const stopped = AbortSignal.abort(new Error("left"));
  await expect(
    readChannelNotifications(config, userId, channelId, stopped),
  ).rejects.toBe(stopped.reason);
  expect(fetchApi).not.toHaveBeenCalled();
  await expect(
    readChannelNotifications(config, userId, channelId),
  ).rejects.toMatchObject({
    name: ResponseError.name,
    response: { status: 403 },
  });
});

test.each(["abort", "close"])(
  "discards both values after %s during profile decoding",
  async (outcome) => {
    vi.mocked(invoke).mockResolvedValueOnce(91);
    const account = await openAccountRestConnection(
      "https://first.example.test/site",
      userId,
    );
    let finish!: () => void;
    vi.spyOn(UsersApi.prototype, "getUser").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ id: userId, notifyProps: {} });
        }),
    );
    const membership = vi
      .spyOn(ChannelsApi.prototype, "getChannelMember")
      .mockResolvedValueOnce({
        channelId,
        userId,
        notifyProps: {},
      });
    const controller = new AbortController();
    const result = account.readChannelNotifications(
      channelId,
      controller.signal,
    );
    expect(membership).toHaveBeenCalledOnce();
    if (outcome === "abort") controller.abort(new Error("closed panel"));
    else await account.close();
    finish();
    await expect(result).rejects.toBe(
      outcome === "abort" ? controller.signal.reason : "cancelled",
    );
  },
);
