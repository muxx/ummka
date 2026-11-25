type ChannelMention = "@channel" | "@all" | "@here";
type Audience = { members: number; timezones: number };
type GroupMention = Audience & { handle: string };
type Confirmation = Audience & {
  kind: "channel" | "here" | "groups";
  mentions: string[];
};

type Mentions = {
  /** References recognized in rendered message text. A group has already passed its reference and source checks. */
  channel: readonly ChannelMention[];
  groups: readonly GroupMention[];
};
type Policy = {
  confirmNotifications: boolean;
  maxNotificationsPerChannel: bigint;
  canMentionChannel: boolean;
  canMentionGroups: boolean;
};

const confirmationThreshold = 5;

/** Decide from the server's channel counts. A group count is its overlap with this channel. */
export function mentionConfirmation(
  mentions: Mentions,
  audience: Audience,
  policy: Policy,
) {
  let channelSuppression: "permission" | "limit" | null = null;
  let confirmation: Confirmation | null = null;
  if (mentions.channel.length) {
    if (!policy.canMentionChannel) channelSuppression = "permission";
    else if (audience.members >= policy.maxNotificationsPerChannel)
      channelSuppression = "limit";
    else if (
      policy.confirmNotifications &&
      audience.members > confirmationThreshold
    ) {
      confirmation = {
        kind: mentions.channel.some((token) => token !== "@here")
          ? "channel"
          : "here",
        mentions: [...new Set(mentions.channel)],
        members: audience.members - 1,
        timezones: audience.timezones,
      };
    }
  }
  const groupsSuppressed =
    mentions.groups.length > 0 && !policy.canMentionGroups;
  if (!confirmation && !groupsSuppressed && policy.confirmNotifications) {
    let largest: GroupMention | undefined;
    for (const group of mentions.groups)
      if (
        group.members > confirmationThreshold &&
        (!largest || group.members > largest.members)
      )
        largest = group;
    if (largest) {
      confirmation = {
        kind: "groups",
        mentions: [
          ...new Set(mentions.groups.map((group) => "@" + group.handle)),
        ],
        members: largest.members,
        timezones: largest.timezones,
      };
    }
  }
  return { confirmation, channelSuppression, groupsSuppressed };
}
