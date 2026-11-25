import type { TeamWorkspace } from "../entry/AccountTeamWindow.tsx";
import type { savedChannelPermissions } from "../mattermost/channel-permissions.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import { resolveComposerSubmission } from "./composer-submission.ts";
import { submitChannelReaction } from "./submit-channel-reaction.ts";
import { submitVisibleCommand } from "./submit-visible-command.ts";
import type { DraftSendContext } from "./use-draft-send.ts";

export function channelDraftActions(
  { connection, team, userId, policy, sessionIssue }: TeamWorkspace,
  channel: TeamSidebar["data"]["channels"][number],
  permission: ReturnType<typeof savedChannelPermissions>,
  collapsedThreads: boolean | null,
): DraftSendContext {
  return {
    post: {
      account: connection,
      channel,
      team: channel.kind === "D" || channel.kind === "G" ? null : team,
      settings: policy.server.value?.mentions,
      channelPermission: permission(channel, "use_channel_mentions"),
      groupPermission: permission(channel, "use_group_mentions"),
    },
    route: (message, signal) =>
      resolveComposerSubmission(
        { message, hasAttachments: false, scheduled: false },
        connection,
        signal,
      ),
    performOther: async (route, draft, signal) => {
      if (route.kind === "blockedReaction" || route.kind === "blockedCommand")
        return route;
      if (route.kind === "reaction") {
        const answer = await submitChannelReaction(
          {
            account: connection,
            channelId: channel.id,
            userId,
            collapsedThreads,
            archived: Boolean(channel.deleteAt),
            add: permission(channel, "add_reaction"),
            remove: permission(channel, "remove_reaction"),
            uniqueLimit: policy.server.value?.uniqueReactionLimit,
          },
          route,
          draft,
          signal,
        );
        return { kind: "reaction", answer, emoji: route.emoji };
      }
      return submitVisibleCommand(
        connection,
        { channelId: channel.id, teamId: team.id },
        draft,
        signal,
        () => sessionIssue("unauthorized"),
      );
    },
  };
}
