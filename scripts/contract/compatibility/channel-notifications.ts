import assert from "node:assert/strict";
import type {
  ChannelNotifyProps,
  ChannelsApi,
} from "../../../vendor/mattermost/index.js";

export async function checkChannelNotifications(
  api: ChannelsApi,
  channelId: string,
) {
  const own = { channelId, userId: "me" };
  const read = async () => {
    const { notifyProps } = await api.getChannelMember(own);
    assert.ok(notifyProps);
    return notifyProps;
  };
  const original = await read();
  const overrides = {
    desktopSound: "on",
    desktopNotificationSound: "Crackle",
    desktopThreads: "all",
    pushThreads: "mention",
    ignoreChannelMentions: "on",
    channelAutoFollowThreads: "on",
  };
  const write = async (channelNotifyProps: ChannelNotifyProps) => {
    const response = await api.updateChannelNotifyPropsRaw({
      ...own,
      channelNotifyProps,
    });
    assert.equal(response.raw.status, 200);
    assert.equal((await response.value()).status, "OK");
  };
  await write(overrides);
  assert.deepEqual(await read(), { ...original, ...overrides });
  const defaults = {
    desktopSound: "default",
    desktopNotificationSound: "default",
    desktopThreads: "default",
    pushThreads: "default",
    ignoreChannelMentions: "default",
    channelAutoFollowThreads: "off",
  };
  await write(defaults);
  assert.deepEqual(await read(), { ...original, ...defaults });
}
