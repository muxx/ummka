import assert from "node:assert/strict";
import {
  ChannelsApi,
  type Configuration,
  ResponseError,
  TeamsApi,
} from "../../../vendor/mattermost/index.js";

type Named = { id: string; name: string };

export async function checkNamedRoutes(
  owner: Configuration,
  viewer: Configuration,
  viewerId: string,
  team: Named,
  otherTeam: Named,
  publicRoom: Named,
  create: (route: string, body: object) => Promise<Response>,
  archive: (channelId: string) => Promise<Response>,
) {
  const teams = new TeamsApi(viewer);
  const channels = new ChannelsApi(viewer);
  const ownTeams = await teams.getTeamsForUser({ userId: "me" });
  assert.ok(ownTeams.some((row) => row.id === team.id));
  assert.ok(!ownTeams.some((row) => row.id === otherTeam.id));
  for (const expected of [team, otherTeam]) {
    const result = await teams.getTeamByName({ name: expected.name });
    assert.equal(result.id, expected.id);
    assert.equal(result.name, expected.name);
    assert.equal(result.type, "O");
    assert.equal(result.deleteAt, 0);
  }
  const closedTeam = await (
    await create("teams", {
      name: "invite-link-team",
      display_name: "Invite link team",
      type: "I",
      allow_open_invite: false,
    })
  ).json();
  await assert.rejects(
    teams.getTeamByName({ name: closedTeam.name }),
    (e: unknown) => e instanceof ResponseError && e.response.status === 403,
  );

  const read = (channelName: string, includeDeleted?: boolean) =>
    channels.getChannelByNameForTeamName({
      teamName: team.name,
      channelName,
      includeDeleted,
    });
  const missing = (e: unknown) =>
    e instanceof ResponseError && e.response.status === 404;
  const open = await read(publicRoom.name);
  assert.equal(open.id, publicRoom.id);
  assert.equal(open.teamId, team.id);
  assert.equal(open.type, "O");
  assert.equal(open.deleteAt, 0);
  const otherRoom = await new ChannelsApi(owner).getChannelByNameForTeamName({
    teamName: otherTeam.name,
    channelName: "town-square",
  });
  const ownRoom = await read("town-square");
  assert.equal(otherRoom.teamId, otherTeam.id);
  assert.equal(ownRoom.teamId, team.id);
  assert.notEqual(ownRoom.id, otherRoom.id);

  const privateRoom = await (
    await create("channels", {
      team_id: team.id,
      name: "named-link",
      display_name: "Named link",
      type: "P",
    })
  ).json();
  await assert.rejects(read(privateRoom.name, true), missing);
  await assert.rejects(read("missing-named-route", true), missing);
  await create(`channels/${privateRoom.id}/members`, { user_id: viewerId });
  const joined = await read(privateRoom.name, true);
  assert.equal(joined.id, privateRoom.id);
  assert.equal(joined.type, "P");
  assert.equal(joined.teamId, team.id);
  assert.equal(joined.name, privateRoom.name);
  assert.equal(joined.deleteAt, 0);
  assert.equal((await archive(privateRoom.id)).status, 200);
  const archived = await read(privateRoom.name, true);
  assert.equal(archived.id, privateRoom.id);
  assert.ok(archived.deleteAt && archived.deleteAt > 0);
  await assert.rejects(read(privateRoom.name, false), missing);
}
