import {
  ChannelsApi,
  type Configuration,
  EmojiApi,
  GroupFromJSON,
  GroupsApi,
  PostsApi,
  PreferencesApi,
  ReactionsApi,
  RolesApi,
  TeamsApi,
} from "../../vendor/mattermost/index.js";
import { checkGroupAssociations } from "./group-associations.ts";

export async function checkTeamReads(
  root: Configuration,
  prefixed: Configuration,
) {
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
  const postId = "p".repeat(26);
  if ((await new ReactionsApi(root).getReactions({ postId })) !== null)
    throw Error("empty signed post reaction list");
  const storedReactions = await new ReactionsApi(prefixed).getReactions({
    postId,
  });
  const reaction = storedReactions?.[0];
  if (
    storedReactions?.length !== 1 ||
    reaction?.postId !== postId ||
    reaction.emojiName !== "+1" ||
    reaction.updateAt !== 34 ||
    reaction.deleteAt !== 0 ||
    reaction.remoteId !== null ||
    reaction.channelId !== "c".repeat(26)
  )
    throw Error("signed reaction with nullable remote id");
  const reactionsApi = new ReactionsApi(prefixed);
  const newReaction = await reactionsApi.saveReaction({
    saveReactionRequest: {
      userId: "Abc01234567890123456789012",
      postId,
      emojiName: "+1",
    },
  });
  if (newReaction.emojiName !== "+1" || newReaction.createAt !== 42)
    throw Error("signed reaction creation");
  if (
    (
      await reactionsApi.deleteReaction({
        userId: "me",
        postId,
        emojiName: "+1",
      })
    ).status !== "OK"
  )
    throw Error("signed reaction removal");
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
  const unread = await new PostsApi(prefixed).setPostUnread({
    userId: "me",
    postId: "p".repeat(26),
    setPostUnreadRequest: { collapsedThreadsSupported: true },
  });
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
