import type { savedChannelPermissions } from "../mattermost/channel-permissions.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";

type Channel = Pick<
  TeamSidebar["data"]["channels"][number],
  "kind" | "roles" | "name" | "deleteAt"
>;

export function channelManagementAccess(
  permission: ReturnType<typeof savedChannelPermissions>,
  channel?: Channel,
) {
  const teamChannel = channel?.kind === "O" || channel?.kind === "P";
  const active = teamChannel && channel.deleteAt === 0;
  const isDefault = channel?.name === "town-square";
  const isPublic = channel?.kind === "O";
  return {
    createPublic: permission("team", "create_public_channel"),
    createPrivate: permission("team", "create_private_channel"),
    editProperties: active
      ? permission(
          channel,
          isPublic
            ? "manage_public_channel_properties"
            : "manage_private_channel_properties",
        )
      : "denied",
    archive:
      active && !isDefault
        ? permission(
            channel,
            isPublic ? "delete_public_channel" : "delete_private_channel",
          )
        : "denied",
    restore:
      teamChannel && channel.deleteAt > 0 && !isDefault
        ? permission("team", "manage_team")
        : "denied",
  } as const;
}
