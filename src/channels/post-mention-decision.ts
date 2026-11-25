import { readBroadcastDecision } from "./broadcast-audience.ts";
import type { composerPostMentions } from "./composer-mentions.ts";
import { readGroupMentionAudience } from "./group-mention-audience.ts";
import {
  type MentionPolicy,
  mentionConfirmation,
} from "./mention-confirmation.ts";

type Directory = Parameters<typeof readGroupMentionAudience>;
type Account = Parameters<typeof readBroadcastDecision>[0] & Directory[0];

export async function readPostMentionDecision(
  account: Account,
  channel: Directory[1],
  team: Directory[2],
  mentions: ReturnType<typeof composerPostMentions>,
  policy: MentionPolicy & Directory[4],
  signal?: AbortSignal,
) {
  const broadcast = await readBroadcastDecision(
    account,
    channel.id,
    mentions.channel,
    policy,
    signal,
  );
  signal?.throwIfAborted();
  const suppression =
    broadcast.channelSuppression === "limit"
      ? {
          kind: "limit" as const,
          members: broadcast.memberCount,
          maximum: policy.maxNotificationsPerChannel,
        }
      : broadcast.channelSuppression === "permission"
        ? { kind: "permission" as const }
        : null;
  let confirmation = broadcast.confirmation;
  if (!confirmation && mentions.groupCandidates.length) {
    const audience = await readGroupMentionAudience(
      account,
      channel,
      team,
      mentions.groupCandidates,
      policy,
      signal,
    );
    signal?.throwIfAborted();
    if (audience.kind !== "ready") return audience;
    confirmation = mentionConfirmation(
      { channel: [], groups: audience.groups },
      { members: 0, timezones: 0 },
      policy,
    ).confirmation;
  }
  return { kind: "ready" as const, confirmation, suppression };
}
