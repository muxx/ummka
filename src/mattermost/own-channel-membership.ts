import {
  type ChannelMember,
  ChannelsApi,
  type Configuration,
} from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";

export async function loadOwnChannelMemberships(
  config: Configuration,
  userId: string,
  teamId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(userId) || !isMattermostId(teamId))
    throw new TypeError("Invalid Mattermost membership scope.");

  const reply = await new ChannelsApi(config).getChannelMembersForUserRaw(
    { userId: "me", teamId },
    { signal },
  );
  if (reply.raw.status !== 200) {
    void reply.raw.body?.cancel().catch(() => {});
    throw new TypeError("Incomplete Mattermost channel membership response.");
  }
  const records = await reply.value();
  signal?.throwIfAborted();
  const members = new Map<string, ChannelMember>();
  for (const row of records) {
    if (
      !isMattermostId(row?.channelId) ||
      row.userId !== userId ||
      members.has(row.channelId)
    )
      throw new TypeError("Invalid Mattermost channel membership.");
    members.set(row.channelId, row);
  }
  return members;
}

export async function readOwnChannelMembership(
  config: Configuration,
  userId: string,
  teamId: string,
  channelId: string,
  signal?: AbortSignal,
): Promise<"member" | "absent"> {
  if (!isMattermostId(channelId))
    throw new TypeError("Invalid Mattermost channel ID.");
  const members = await loadOwnChannelMemberships(
    config,
    userId,
    teamId,
    signal,
  );
  return members.has(channelId) ? "member" : "absent";
}
