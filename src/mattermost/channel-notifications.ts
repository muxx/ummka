import {
  type ChannelNotifyProps,
  ChannelsApi,
  type Configuration,
  type UserNotifyProps,
  UsersApi,
} from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";

const accountFields = [
  "desktop",
  "push",
  "desktopSound",
  "desktopNotificationSound",
  "desktopThreads",
  "pushThreads",
  "channel",
] as const satisfies readonly (keyof UserNotifyProps)[];

function selectedFields<K extends string>(
  props: Partial<Record<NoInfer<K>, string>>,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const selected: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = props[key];
    if (value === undefined) continue;
    if (typeof value !== "string")
      throw new TypeError("Invalid Mattermost notification value.");
    selected[key] = value;
  }
  return selected;
}

export async function readChannelNotifications(
  config: Configuration,
  userId: string,
  channelId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(channelId))
    throw new TypeError("Invalid Mattermost channel ID.");
  const [user, member] = await Promise.all([
    new UsersApi(config).getUser({ userId: "me" }, { signal }),
    new ChannelsApi(config).getChannelMember(
      { channelId, userId: "me" },
      { signal },
    ),
  ]);
  signal?.throwIfAborted();
  if (
    user.id !== userId ||
    member.userId !== userId ||
    member.channelId !== channelId ||
    !user.notifyProps ||
    !member.notifyProps
  )
    throw new TypeError("Invalid Mattermost notification owner.");
  return {
    account: selectedFields(user.notifyProps, accountFields),
    channel: selectedFields(
      member.notifyProps,
      Object.keys(member.notifyProps) as (keyof ChannelNotifyProps)[],
    ),
  };
}
