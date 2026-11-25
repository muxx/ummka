import assert from "node:assert/strict";
import { projectJoinedTeams } from "../../../src/mattermost/joined-teams.ts";
import {
  loadAccountDirectory,
  loadTeamDirectory,
} from "../../../src/mattermost/navigation-data.ts";
import { projectTeamSidebar } from "../../../src/mattermost/team-sidebar.ts";
import {
  ChannelsApi,
  Configuration,
  ResponseError,
  TeamsApi,
} from "../../../vendor/mattermost/index.js";

export async function checkNavigationMemberships(
  session: Configuration,
  userId: string,
  admin: { session: Configuration; userId: string },
  keepTeamId: string,
  leaveTeamId: string,
  channelId: string,
  directId: string,
  leaveTeam: () => Promise<Response>,
) {
  const teams = new TeamsApi(session);
  const own = { userId: "me" };
  const active = await teams.getTeamMembersForUser(own);
  await assert.rejects(
    teams.getTeamMembersForUser({ userId: admin.userId }),
    (e: unknown) => e instanceof ResponseError && e.response.status === 403,
  );
  const permitted = await new TeamsApi(admin.session).getTeamMembersForUser({
    userId,
  });
  assert.ok(
    permitted.some((m) => m.teamId === keepTeamId && m.userId === userId),
  );
  const member = active.find((m) => m.teamId === leaveTeamId);
  assert.ok(member);
  const joined = await loadAccountDirectory(session, userId);
  const teamRows = projectJoinedTeams(joined);
  for (const id of [keepTeamId, leaveTeamId]) {
    const row = teamRows.find((team) => team.id === id);
    assert.ok(row?.name && row.displayName);
  }
  for (const teamId of [keepTeamId, leaveTeamId]) {
    const directory = await loadTeamDirectory(session, userId, teamId);
    const projection = projectTeamSidebar(directory);
    assert.deepEqual(
      projection.categories.map((c) => [c.id, c.channelIds]),
      directory.categories.map((c) => [c.id, c.channelIds]),
    );
    assert.ok(
      projection.channels.some((c) => c.id === directId && c.kind === "D"),
    );
    const known = projection.channels.find((c) => c.id === channelId);
    if (teamId === keepTeamId) {
      assert.ok(
        known && known.totalMsgCount !== null && known.msgCount !== null,
      );
      assert.equal(
        known.muted,
        directory.channels.find((row) => row.channel.id === channelId)
          ?.membership.notifyProps?.markUnread === "mention",
      );
    }
    const dm = directory.channels.find((row) => row.channel.id === directId);
    assert.ok(
      dm &&
        dm.channel.type === "D" &&
        dm.channel.teamId === "" &&
        dm.membership.userId === userId,
    );
    assert.ok(
      directory.categories
        .find((c) => c.type === "direct_messages")
        ?.channelIds?.includes(directId),
    );
  }
  assert.deepEqual(
    joined.teams.find(({ team }) => team.id === leaveTeamId)?.membership,
    member,
  );
  assert.ok(
    joined.preferences.every((preference) => preference.userId === userId),
  );
  assert.deepEqual(member, {
    teamId: leaveTeamId,
    userId,
    deleteAt: 0,
    roles: "team_user",
    explicitRoles: "",
    schemeGuest: false,
    schemeUser: true,
    schemeAdmin: false,
  });
  assert.ok(
    (await teams.getTeamsForUser(own)).some((team) => team.id === leaveTeamId),
  );
  const channels = await new ChannelsApi(session).getChannelMembersForUser({
    ...own,
    teamId: keepTeamId,
  });
  const channel = channels.find((m) => m.channelId === channelId);
  assert.ok(channel);
  assert.deepEqual(
    [
      channel.userId,
      channel.roles,
      channel.explicitRoles,
      channel.schemeGuest,
      channel.schemeUser,
      channel.schemeAdmin,
    ],
    [userId, "channel_user", "", false, true, false],
  );

  const leave = await leaveTeam();
  assert.ok(leave.ok, `Leave fixture team: HTTP ${leave.status}`);
  const after = await teams.getTeamMembersForUser({ userId });
  const removed = after.find((m) => m.teamId === leaveTeamId);
  assert.ok(removed?.deleteAt && removed.deleteAt > 0);
  assert.equal(after.find((m) => m.teamId === keepTeamId)?.deleteAt, 0);
  const remaining = await loadAccountDirectory(session, userId);
  assert.equal(
    projectJoinedTeams(remaining).some((team) => team.id === leaveTeamId),
    false,
  );
  assert.ok(remaining.teams.some(({ team }) => team.id === keepTeamId));
  assert.ok(!remaining.teams.some(({ team }) => team.id === leaveTeamId));
  await assert.rejects(
    loadTeamDirectory(session, userId, leaveTeamId),
    (e: unknown) => e instanceof ResponseError && e.response.status === 403,
  );
  assert.ok(
    !(await teams.getTeamsForUser(own)).some((team) => team.id === leaveTeamId),
  );
  const anonymous = new TeamsApi(
    new Configuration({ basePath: session.basePath }),
  );
  await assert.rejects(
    anonymous.getTeamMembersForUser(own),
    (e: unknown) => e instanceof ResponseError && e.response.status === 401,
  );
}

export async function checkEmptyTeamDirectory(
  session: Configuration,
  userId: string,
  teamId: string,
) {
  const channels = new ChannelsApi(session);
  const scope = { userId: "me", teamId };
  await assert.rejects(
    channels.getChannelsForTeamForUser({ ...scope, includeDeleted: true }),
    (error: unknown) =>
      error instanceof ResponseError && error.response.status === 404,
  );
  const actual = await loadTeamDirectory(session, userId, teamId);
  const expectedSidebar =
    await channels.getSidebarCategoriesForTeamForUser(scope);
  assert.deepEqual(actual.channels, []);
  assert.deepEqual(
    actual.categories.map((category) => category.id),
    expectedSidebar.order,
  );
  assert.ok(
    actual.categories.every((category) => category.channelIds?.length === 0),
  );
}
