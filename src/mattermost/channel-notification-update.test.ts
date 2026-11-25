import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, test, vi } from "vitest";
import {
  type ChannelNotifyProps,
  ChannelsApi,
  Configuration,
} from "../../vendor/mattermost/index.js";
import { updateChannelNotifications } from "./channel-notifications.ts";
import { openAccountRestConnection } from "./native-rest.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});
const channelId = "c".repeat(26);
const basePath = "https://chat.example.test/deployment";

test("sends just the changed settings to the current member", async () => {
  const fetchApi = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe(
        `${basePath}/api/v4/channels/${channelId}/members/me/notify_props`,
      );
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toStrictEqual({
        push_threads: "default",
        desktop_notification_sound: "Crackle",
      });
      return Response.json({ status: "OK" });
    },
  );
  await updateChannelNotifications(
    new Configuration({ basePath, fetchApi }),
    channelId,
    {
      pushThreads: "default",
      desktopNotificationSound: "Crackle",
      push: undefined,
    },
  );
  expect(fetchApi).toHaveBeenCalledOnce();
});

test("invalid fields, types, recipient, empty patch and cancellation stop before transport", async () => {
  const fetchApi = vi.fn<typeof fetch>();
  const config = new Configuration({ basePath, fetchApi });
  for (const patch of [
    null,
    [],
    {},
    { desktop: undefined },
    { unknown: "all" },
    { userId: "me" },
    { push: 2 },
    Object.create({ desktop: "all" }),
  ] as unknown as ChannelNotifyProps[]) {
    await expect(
      updateChannelNotifications(config, channelId, patch),
    ).rejects.toBeInstanceOf(TypeError);
  }
  await expect(
    updateChannelNotifications(config, "bad", { push: "all" }),
  ).rejects.toBeInstanceOf(TypeError);
  const stopped = AbortSignal.abort(new Error("left"));
  await expect(
    updateChannelNotifications(config, channelId, { push: "all" }, stopped),
  ).rejects.toBe(stopped.reason);
  expect(fetchApi).not.toHaveBeenCalled();
});

test.each(["unexpected status", "forbidden", "disconnected"])(
  "a %s does not confirm or retry a change",
  async (outcome) => {
    const fetchApi = vi.fn(async () => {
      if (outcome === "disconnected") throw new TypeError("offline");
      if (outcome === "forbidden") return Response.json({}, { status: 403 });
      return Response.json({ status: "not saved" });
    });
    const result = updateChannelNotifications(
      new Configuration({ basePath, fetchApi }),
      channelId,
      { desktop: "none" },
    );
    if (outcome === "forbidden")
      await expect(result).rejects.toMatchObject({ response: { status: 403 } });
    else if (outcome === "disconnected")
      await expect(result).rejects.toMatchObject({
        cause: { message: "offline" },
      });
    else await expect(result).rejects.toThrow("did not confirm");
    expect(fetchApi).toHaveBeenCalledOnce();
  },
);

test.each(["close", "abort"])(
  "a late acknowledgement after %s cannot update another panel",
  async (outcome) => {
    vi.mocked(invoke).mockResolvedValueOnce(7);
    const account = await openAccountRestConnection(basePath, "u".repeat(26));
    let finish!: () => void;
    const write = vi
      .spyOn(ChannelsApi.prototype, "updateChannelNotifyProps")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({ status: "OK" });
          }),
      );
    const controller = new AbortController();
    const pending = account.updateChannelNotifications(
      channelId,
      { push: "none" },
      controller.signal,
    );
    if (outcome === "close") await account.close();
    else controller.abort(new Error("left"));
    finish();
    await expect(pending).rejects.toBe(
      outcome === "close" ? "cancelled" : controller.signal.reason,
    );
    expect(write).toHaveBeenCalledOnce();
  },
);
