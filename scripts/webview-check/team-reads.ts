import { openChannelDirectoryList } from "../../src/channels/open-channel-directory.ts";
import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";
import {
  ChannelsApi,
  Configuration,
  EmojiApi,
  GroupFromJSON,
  GroupsApi,
  PreferencesApi,
  ResponseError,
  RolesApi,
  TeamsApi,
} from "../../vendor/mattermost/index.js";
import { checkGroupAssociations } from "./group-associations.ts";

export async function checkTeamReads(
  rootAccount: Awaited<ReturnType<typeof openAccountRestConnection>>,
  prefixedAccount: Awaited<ReturnType<typeof openAccountRestConnection>>,
) {
  const roster = await prefixedAccount.readChannelMemberDirectory(
    "r".repeat(26),
    { kind: "page", page: 0 },
  );
  if (
    roster.nextPage !== null ||
    roster.members.length !== 1 ||
    roster.members[0].profile.username !== "roster-reader" ||
    !roster.members[0].schemeAdmin
  )
    throw Error("Native account returned the wrong channel roster");
  const root = new Configuration(rootAccount);
  const prefixed = new Configuration(prefixedAccount);
  const entry = await new EmojiApi(prefixed).getEmojiByName({
    emojiName: "fixture+wave",
  });
  if (
    entry.name !== "fixture+wave" ||
    entry.id !== "e".repeat(26) ||
    entry.creatorId !== "Abc01234567890123456789012" ||
    entry.createAt !== 42 ||
    entry.updateAt !== 43 ||
    entry.deleteAt !== 0
  )
    throw Error("signed exact custom emoji lookup");
  const names = ["team_guest", "channel_user"];
  const roleApi = new RolesApi(prefixed);
  const roles = await roleApi.getRolesByNames({
    requestBody: names,
  });
  if (
    !roles ||
    (await roleApi.getRolesByNames({ requestBody: ["fixture_missing"] })) !==
      null
  )
    throw Error("generated nullable role list");
  const writer = roles.find((role) => role.name === "channel_user");
  const guest = roles.find((role) => role.name === "team_guest");
  if (
    names.join(",") !== "team_guest,channel_user" ||
    roles.length !== 2 ||
    writer?.displayName !== "Channel member" ||
    !writer.schemeManaged ||
    writer.permissions?.join(",") !== "read_channel,create_post" ||
    guest?.permissions?.length !== 0
  )
    throw Error("generated role definitions");
  const teams = await new TeamsApi(root).getTeamsForUser({ userId: "me" });
  const teamId = teams[0]?.id;
  if (
    teams.length !== 1 ||
    !teamId ||
    teams[0].displayName !== "Fixture Team" ||
    teams[0].groupConstrained !== true
  )
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
  const namedTeam = await new TeamsApi(prefixed).getTeamByName({
    name: "fixture-team",
  });
  if (
    namedTeam.id !== teamId ||
    namedTeam.name !== "fixture-team" ||
    namedTeam.type !== "O" ||
    namedTeam.allowOpenInvite !== true ||
    namedTeam.deleteAt !== 0
  )
    throw Error("generated signed team by name");
  const named = await api.getChannelByNameForTeamName({
    teamName: "fixture-team",
    channelName: "old_room",
    includeDeleted: true,
  });
  if (
    named.teamId !== teamId ||
    named.id !== "c".repeat(26) ||
    named.name !== "old_room" ||
    named.deleteAt !== 41 ||
    named.type !== "O"
  )
    throw Error("generated signed channel by team and channel names");
  const location = "j".repeat(26);
  const inspected = await api.getChannel({ channelId: location });
  if (
    inspected.id !== location ||
    inspected.type !== "G" ||
    inspected.teamId !== "" ||
    inspected.deleteAt !== 0
  )
    throw Error("generated signed channel by ID");
  const open = await prefixedAccount.readChannelDirectoryPage({
    teamId,
    page: 1,
    kind: "public",
  });
  const archiveList = openChannelDirectoryList(
    prefixedAccount,
    teamId,
    "archived",
  );
  await archiveList.more();
  const archive = archiveList.getSnapshot();
  archiveList.close();
  if (
    open.items.length !== 1 ||
    open.hasMore ||
    open.items[0].id !== "o".repeat(26) ||
    open.items[0].displayName !== "Systems" ||
    open.items[0].deleteAt !== 0 ||
    archive.status !== "ready" ||
    archive.items.length !== 1 ||
    archive.hasMore ||
    archive.items[0].id !== "p".repeat(26) ||
    archive.items[0].kind !== "P" ||
    archive.items[0].deleteAt !== 42 ||
    archive.items[0].purpose !== "Fixture design"
  )
    throw Error("signed account channel directory pages");
  for (const operation of [
    "getPublicChannelsForTeam",
    "getDeletedChannelsForTeam",
  ] as const) {
    try {
      await api[operation]({ teamId: "z".repeat(26), page: 0, perPage: 50 });
      throw Error("Expected a forbidden directory response for " + operation);
    } catch (error) {
      if (!(error instanceof ResponseError) || error.response.status !== 403)
        throw error;
    }
  }
  const found = await prefixedAccount.searchChannelDirectory(
    teamId,
    "  Northern lights  ",
  );
  if (
    found.length !== 1 ||
    found[0].id !== "p".repeat(26) ||
    found[0].kind !== "P" ||
    found[0].deleteAt !== 42 ||
    found[0].displayName !== "Northern lights"
  )
    throw Error("signed account channel directory search");
  const managed = await api.getManagedCategories({ teamId });
  if (
    Object.keys(managed).length !== 2 ||
    managed["c".repeat(26)] !== "Release" ||
    managed["d".repeat(26)] !== "Release"
  )
    throw Error("generated managed category assignments");
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
    channels[0].groupConstrained !== true ||
    channels[0].name !== "town-square" ||
    channels[0].teamId !== teamId
  )
    throw Error("generated channel list");
  const channelMatches = await api.autocompleteChannelsForTeam({
    teamId,
    name: "тест +&",
  });
  if (
    channelMatches.length !== 1 ||
    channelMatches[0]?.id !== channelId ||
    channelMatches[0]?.teamId !== teamId
  )
    throw Error("signed team-scoped directory search");
  const stats = await api.getChannelStats({
    channelId,
    excludeFilesCount: true,
  });
  if (
    stats.channelId !== channelId ||
    stats.memberCount !== 30 ||
    stats.guestCount !== 3 ||
    stats.pinnedpostCount !== 5 ||
    stats.filesCount !== -1
  )
    throw Error("generated channel stats");
  if (
    (await new ChannelsApi(root).getChannelMembersTimezones({ channelId })) !==
    null
  )
    throw Error("generated nullable channel timezones");
  const groups = await api.getChannelMemberCountsByGroup({
    channelId,
    includeTimezones: true,
  });
  if (
    groups.length !== 2 ||
    groups[0].groupId !== "g".repeat(26) ||
    groups[0].channelMemberCount !== 3 ||
    groups[0].channelMemberTimezonesCount !== 2 ||
    groups[1].groupId !== "h".repeat(26) ||
    groups[1].channelMemberCount !== 1 ||
    groups[1].channelMemberTimezonesCount !== 0
  )
    throw Error("generated channel group counts");
  if (
    (await new ChannelsApi(root).getChannelMemberCountsByGroup({ channelId }))
      .length !== 0
  )
    throw Error("empty channel group counts");
  await checkGroupAssociations(root, prefixed, teamId, channelId);
  const matches = await new GroupsApi(prefixed).getGroups({
    q: "release qa",
    page: 0,
    perPage: 60,
    filterAllowReference: true,
    includeMemberCount: true,
  });
  if (
    matches.length !== 2 ||
    matches[0].name !== "release-qa" ||
    matches[0].source !== "custom" ||
    matches[0].remoteId !== null ||
    !matches[0].allowReference ||
    matches[0].memberCount !== 7 ||
    matches[1].remoteId !== "directory-record" ||
    matches[1].source !== "ldap" ||
    matches[1].name !== "qa"
  )
    throw Error("generated group search projection");
  // A group without a handle is valid only outside referenceable search results.
  const unnamed = GroupFromJSON({
    id: "j".repeat(26),
    display_name: "Legacy directory",
    source: "ldap",
    remote_id: "legacy-record",
    allow_reference: false,
  });
  if (
    unnamed.name !== undefined ||
    unnamed.allowReference ||
    unnamed.memberCount !== undefined
  )
    throw Error("generated non-referenceable group");
  if (
    (
      await new GroupsApi(root).getGroups({
        q: "absent",
        filterAllowReference: true,
      })
    ).length
  )
    throw Error("empty group directory search");
  const single = await rootAccount.viewChannel(channelId);
  const cleared = await rootAccount.viewChannel(null);
  const other = "v".repeat(26);
  const bulk = await prefixedAccount.markChannelsRead([channelId, other]);
  if (
    single[channelId] !== 121 ||
    Object.keys(cleared).length !== 0 ||
    bulk[channelId] !== 123 ||
    bulk[other] !== 126
  )
    throw Error("generated channel read timestamps");
  if (open.items[0].header !== "Current systems")
    throw Error("signed public channel directory topic");
  const userId = "Abc01234567890123456789012";
  const notification = await api.updateChannelNotifyProps({
    channelId,
    userId: "me",
    channelNotifyProps: {
      desktopNotificationSound: "Crackle",
      channelAutoFollowThreads: "on",
    },
  });
  if (notification.status !== "OK")
    throw Error("signed partial channel notification update");
  const added = await api.addChannelMember({
    channelId,
    addChannelMemberRequest: { userId, postRootId: "r".repeat(26) },
  });
  if (added.channelId !== channelId || added.userId !== userId)
    throw Error("signed channel member addition");
  const removed = await api.removeUserFromChannel({ channelId, userId });
  if (removed.status !== "OK") throw Error("signed channel member removal");
  for (const member of [
    await new ChannelsApi(root).getChannelMember({ channelId, userId: "me" }),
    await api.getChannelMember({ channelId, userId }),
  ]) {
    if (
      member.channelId !== channelId ||
      member.userId !== userId ||
      member.roles !== "channel_user" ||
      member.schemeUser !== true ||
      member.lastViewedAt !== 101 ||
      member.msgCount !== 18 ||
      member.msgCountRoot !== 13 ||
      member.mentionCount !== 6 ||
      member.mentionCountRoot !== 3 ||
      member.urgentMentionCount !== 2 ||
      member.notifyProps?.markUnread !== "mention"
    )
      throw Error("generated individual channel membership");
  }
  const page = await new ChannelsApi(root).getChannelMembers({
    channelId,
    page: 2,
    perPage: 3,
  });
  const subset = await api.getChannelMembersByIds({
    channelId,
    requestBody: [other, userId],
  });
  if (
    page.length !== 1 ||
    page[0].userId !== userId ||
    subset.length !== 2 ||
    subset[0].userId !== userId ||
    subset[1].userId !== other ||
    ![...page, ...subset].every(
      (m) => m.channelId === channelId && m.schemeUser && m.msgCountRoot === 13,
    )
  )
    throw Error("generated channel member lists");
  const unread = await prefixedAccount.markPostUnread(
    channelId,
    "p".repeat(26),
  );
  if (
    unread.teamId !== teamId ||
    unread.userId !== userId ||
    unread.channelId !== channelId ||
    unread.msgCount !== 27 ||
    unread.msgCountRoot !== 24 ||
    unread.mentionCount !== 7 ||
    unread.mentionCountRoot !== 3 ||
    unread.urgentMentionCount !== 2 ||
    unread.lastViewedAt !== 110
  )
    throw Error("generated unread marker");
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
  const saved = await new PreferencesApi(prefixed).getPreferences({
    userId: "me",
  });
  const preference = saved?.[0];
  if (
    preference?.userId !== userId ||
    preference.category !== "direct_channel_show" ||
    preference.name !== "d".repeat(26) ||
    preference.value !== "false"
  )
    throw Error("generated sidebar preferences");
}
