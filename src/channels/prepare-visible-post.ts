import type { ChannelPermission } from "../mattermost/channel-permissions.ts";
import type { ServerPolicy } from "../mattermost/workspace-preferences.ts";
import { composerPostMentions } from "./composer-mentions.ts";
import { readPostMentionDecision } from "./post-mention-decision.ts";

type Directory = Parameters<typeof readPostMentionDecision>;

export type VisiblePostContext = {
  account: Directory[0];
  channel: Directory[1];
  team: Directory[2];
  settings: ServerPolicy["mentions"];
  channelPermission: ChannelPermission;
  groupPermission: ChannelPermission;
};

export async function prepareVisiblePost(
  context: VisiblePostContext,
  message: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const mentions = composerPostMentions(message);
  const wide = mentions.channel.length > 0;
  const groups = mentions.groupCandidates.length > 0;
  if (!wide && !groups)
    return { kind: "ready", confirmation: null, suppression: null } as const;
  const { settings, channelPermission, groupPermission } = context;
  if (!settings || (wide && channelPermission === "unknown"))
    return { kind: "policyUnavailable" } as const;
  const decision = await readPostMentionDecision(
    context.account,
    context.channel,
    context.team,
    mentions,
    {
      ...settings,
      maxNotificationsPerChannel: BigInt(settings.maxNotificationsPerChannel),
      canMentionChannel: channelPermission === "allowed",
      canMentionGroups: groupPermission === "allowed",
    },
    signal,
  );
  if (
    decision.kind === "ready" &&
    !decision.confirmation &&
    groups &&
    settings.confirmNotifications &&
    (settings.ldapGroups || settings.customGroups) &&
    groupPermission === "unknown"
  )
    return { kind: "policyUnavailable" } as const;
  return decision;
}
