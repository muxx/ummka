import type { readPostDestination } from "../mattermost/post-destination.ts";

type Destination = Awaited<ReturnType<typeof readPostDestination>>;

export function nextPostDestinationStep(
  { postId, channel, team }: Destination,
  selectedTeamId: string | null,
) {
  if (!team && !channel.joined) return { kind: "unavailable" } as const;
  const teamId = team?.id ?? selectedTeamId;
  if (teamId === null) return { kind: "selectTeam" } as const;
  if (team) {
    if (!team.joined) return { kind: "joinTeam", team } as const;
    if (!channel.joined) {
      return channel.kind === "P"
        ? ({ kind: "confirmPrivateChannel", team, channel } as const)
        : ({ kind: "joinChannel", team, channel } as const);
    }
  }
  return {
    kind: "readPost",
    teamId,
    channelId: channel.id,
    postId,
  } as const;
}
