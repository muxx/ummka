import type { accountChannelAudience } from "../mattermost/channel-audience.ts";
import {
  type ChannelMention,
  type MentionPolicy,
  mentionConfirmation,
} from "./mention-confirmation.ts";

export async function readBroadcastDecision(
  account: ReturnType<typeof accountChannelAudience>,
  channelId: string,
  mentions: readonly ChannelMention[],
  policy: MentionPolicy,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  try {
    const members =
      mentions.length && policy.canMentionChannel
        ? await account.readChannelMemberCount(channelId, signal)
        : 0;
    signal?.throwIfAborted();
    const result = mentionConfirmation(
      { channel: mentions, groups: [] },
      { members, timezones: 0 },
      policy,
    );
    if (result.confirmation)
      result.confirmation.timezones = await account.readChannelTimezoneCount(
        channelId,
        signal,
      );
    signal?.throwIfAborted();
    return { ...result, memberCount: members };
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
}
