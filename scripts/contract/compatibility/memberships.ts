import assert from "node:assert/strict";
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
