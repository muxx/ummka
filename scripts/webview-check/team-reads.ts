import {
  ChannelsApi,
  type Configuration,
  PreferencesApi,
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
  const [teamMember] = await new TeamsApi(prefixed).getTeamMembersForUser({
    userId: "me",
  });
  if (
    teamMember?.teamId !== teamId ||
    teamMember.schemeGuest !== true ||
    teamMember.roles !== "team_guest" ||
    teamMember.schemeUser !== false ||
    teamMember.schemeAdmin !== false ||
    teamMember.explicitRoles !== "" ||
    teamMember.deleteAt !== 0
  )
    throw Error("generated team membership");
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
  const single = await new ChannelsApi(root).viewChannel({
    userId: "me",
    viewChannelRequest: { channelId, collapsedThreadsSupported: true },
  });
  const other = "v".repeat(26);
  const bulk = await api.markChannelsReadForUser({
    userId: "me",
    requestBody: [channelId, other],
  });
  if (
    single.status !== "OK" ||
    single.lastViewedAtTimes?.[channelId] !== 121 ||
    bulk.status !== "OK" ||
    bulk.lastViewedAtTimes?.[channelId] !== 123 ||
    bulk.lastViewedAtTimes[other] !== 126
  )
    throw Error("generated channel read timestamps");
  const userId = "Abc01234567890123456789012";
  const members = await api.getChannelMembersForUser({ userId, teamId });
  if (
    members.length !== 1 ||
    members[0].userId !== userId ||
    members[0].channelId !== channelId
  )
    throw Error("generated channel memberships");
  const sidebar = await api.getSidebarCategoriesForTeamForUser({
    userId: "me",
    teamId,
  });
  const category = sidebar.categories?.[0];
  if (
    sidebar.order?.length !== 1 ||
    sidebar.order[0] !== category?.id ||
    category?.type !== "managed" ||
    category.userId !== userId ||
    category.teamId !== teamId ||
    category.channelIds?.[0] !== channelId ||
    category.sorting !== "manual" ||
    category.sortOrder !== 0 ||
    category.muted !== false ||
    category.collapsed !== true
  )
    throw Error("generated sidebar categories");
  const [preference] = await new PreferencesApi(prefixed).getPreferences({
    userId: "me",
  });
  if (
    preference?.userId !== userId ||
    preference.category !== "direct_channel_show" ||
    preference.name !== "d".repeat(26) ||
    preference.value !== "false"
  )
    throw Error("generated sidebar preferences");
}
