import {
  ChannelsApi,
  type Configuration,
  TeamsApi,
} from "../../vendor/mattermost/index.js";

export async function checkTeamReads(
  root: Configuration,
  prefixed: Configuration,
) {
  const teams = await new TeamsApi(root).getTeamsForUser({ userId: "me" });
  const teamId = teams[0]?.id;
  if (teams.length !== 1 || !teamId || teams[0].displayName !== "Fixture Team")
    throw Error("generated team list");
  const api = new ChannelsApi(prefixed);
  const channels = await api.getChannelsForTeamForUser({
    userId: "me",
    teamId,
    includeDeleted: false,
    lastDeleteAt: 123,
  });
  const channelId = channels[0]?.id;
  if (
    channels.length !== 1 ||
    !channelId ||
    channels[0].name !== "town-square" ||
    channels[0].teamId !== teamId
  )
    throw Error("generated channel list");
  const userId = "Abc01234567890123456789012";
  const members = await api.getChannelMembersForUser({ userId, teamId });
  if (
    members.length !== 1 ||
    members[0].userId !== userId ||
    members[0].channelId !== channelId
  )
    throw Error("generated channel memberships");
}
