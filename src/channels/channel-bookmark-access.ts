import type {
  ChannelPermission,
  savedChannelPermissions,
} from "../mattermost/channel-permissions.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";

type JoinedChannel = Pick<
  TeamSidebar["data"]["channels"][number],
  "kind" | "deleteAt" | "roles"
>;
type Action = "add" | "edit" | "delete" | "order";

export function channelBookmarkAccess(
  permission: ReturnType<typeof savedChannelPermissions>,
  systemRoles: string | undefined,
  channel: JoinedChannel | null,
  action: Action,
  bookmarkKind?: "link" | "file" | "board",
): ChannelPermission {
  if (channel?.deleteAt !== 0) return "denied";
  if (bookmarkKind === "board" && (action === "edit" || action === "delete"))
    return "denied";
  if (channel.kind === "O" || channel.kind === "P") {
    const scope = channel.kind === "O" ? "public" : "private";
    return permission(channel, `${action}_bookmark_${scope}_channel`);
  }
  if (channel.kind === "D" || channel.kind === "G") {
    // Sidebar rows come from this account's own joined-channel directory.
    if (!systemRoles?.trim()) return "unknown";
    return systemRoles.split(" ").includes("system_guest")
      ? "denied"
      : "allowed";
  }
  return "denied";
}
