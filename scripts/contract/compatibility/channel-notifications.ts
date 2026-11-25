import assert from "node:assert/strict";
import { updateChannelNotifications } from "../../../src/mattermost/channel-notifications.ts";
import type { ChannelNotifyProps } from "../../../vendor/mattermost/index.js";
import {
  ChannelsApi,
  type Configuration,
  ResponseError,
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

export async function checkPersonalNotificationUpdate(
  config: Configuration,
  channelId: string,
  unjoinedChannelId: string,
) {
  const own = new ChannelsApi(config);
  const read = async () => {
    const member = await own.getChannelMember({ channelId, userId: "me" });
    assert.ok(member.notifyProps);
    return member.notifyProps;
  };
  const original = await read();
  assert.equal(original.desktopThreads, "default");
  try {
    await updateChannelNotifications(config, channelId, {
      desktopThreads: "mention",
    });
    assert.deepEqual(await read(), { ...original, desktopThreads: "mention" });
    await assert.rejects(
      updateChannelNotifications(config, unjoinedChannelId, {
        desktopThreads: "all",
      }),
      (error: unknown) =>
        error instanceof ResponseError && error.response.status === 404,
    );
  } finally {
    await updateChannelNotifications(config, channelId, {
      desktopThreads: original.desktopThreads,
    });
    assert.deepEqual(await read(), original);
  }
}
