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

const writableFields = {
  email: true,
  push: true,
  desktop: true,
  markUnread: true,
  desktopThreads: true,
  pushThreads: true,
  ignoreChannelMentions: true,
  channelAutoFollowThreads: true,
  desktopSound: true,
  desktopNotificationSound: true,
} satisfies Record<keyof ChannelNotifyProps, true>;

export async function updateChannelNotifications(
  config: Configuration,
  channelId: string,
  changes: ChannelNotifyProps,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (
    !isMattermostId(channelId) ||
    !changes ||
    typeof changes !== "object" ||
    Array.isArray(changes)
  )
    throw new TypeError("Invalid Mattermost channel notification update.");
  const patch: ChannelNotifyProps = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!Object.hasOwn(writableFields, key))
      throw new TypeError("Invalid Mattermost channel notification field.");
    if (value === undefined) continue;
    if (typeof value !== "string")
      throw new TypeError("Invalid Mattermost notification value.");
    patch[key as keyof ChannelNotifyProps] = value;
  }
  if (Object.keys(patch).length === 0)
    throw new TypeError("Empty Mattermost channel notification update.");
  const result = await new ChannelsApi(config).updateChannelNotifyProps(
    {
      channelId,
      userId: "me",
      channelNotifyProps: patch,
    },
    { signal },
  );
  signal?.throwIfAborted();
  if (result?.status !== "OK")
    throw new TypeError("Mattermost did not confirm the notification update.");
}
