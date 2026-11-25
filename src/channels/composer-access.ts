import type { ChannelPermission } from "../mattermost/channel-permissions.ts";
import {
  type ChannelProfile,
  directPartnerId,
} from "../mattermost/channel-profiles.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";

type ComposerChannel = Pick<
  TeamSidebar["data"]["channels"][number],
  "kind" | "name" | "deleteAt" | "shared"
>;
type AccessContext = {
  channel: ComposerChannel | undefined;
  permission: ChannelPermission;
  userId: string;
  profiles: ReadonlyMap<string, Pick<ChannelProfile, "deleteAt">>;
  sharedChannelDMs: boolean | undefined;
};

export function channelComposerAccess({
  channel,
  permission,
  userId,
  profiles,
  sharedChannelDMs,
}: AccessContext) {
  if (!channel) return "absent";
  if (channel.kind === "D") {
    const partner = directPartnerId(channel.name, userId);
    if (partner && profiles.get(partner)?.deleteAt) return "deactivated";
  }
  if (channel.deleteAt > 0) return "archived";
  if (permission === "denied") return "readOnly";
  if (channel.kind === "D" || channel.kind === "G") {
    if (channel.shared && sharedChannelDMs === false) return "sharedDisabled";
    // A known local conversation or an enabled cross-server policy is sufficient.
    if (channel.shared !== false && sharedChannelDMs !== true) return "unknown";
  }
  return permission === "allowed" ? "writable" : "unknown";
}
