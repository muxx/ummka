import type { ChannelsApi } from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

export async function readChannelIdentity(
  api: Pick<ChannelsApi, "getChannelRaw">,
  channelId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(channelId))
    throw new TypeError("Invalid Mattermost channel ID.");
  const reply = await api.getChannelRaw({ channelId }, { signal });
  if (reply.raw.status !== 200) {
    await reply.raw.body?.cancel();
    throw new TypeError("Incomplete Mattermost channel response.");
  }
  const channel = await reply.value();
  signal?.throwIfAborted();
  if (
    channel?.id !== channelId ||
    typeof channel.name !== "string" ||
    !channel.name.trim() ||
    typeof channel.displayName !== "string" ||
    !isMattermostTime(channel.deleteAt, 0)
  )
    throw new TypeError("Invalid Mattermost channel identity.");
  const { type: kind, teamId, name, displayName, deleteAt } = channel;
  const teamChannel = kind === "O" || kind === "P";
  const direct = kind === "D" || kind === "G";
  if (
    !(teamChannel && isMattermostId(teamId) && displayName.trim()) &&
    !(direct && teamId === "")
  )
    throw new TypeError("Invalid Mattermost conversation kind or team.");
  return { id: channelId, kind, teamId, name, displayName, deleteAt } as const;
}
