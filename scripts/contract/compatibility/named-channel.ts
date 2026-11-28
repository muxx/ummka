import assert from "node:assert/strict";
import { readNamedChannelDestination } from "../../../src/mattermost/named-channel-destination.ts";
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
  const inspect = (teamName: string, channelName: string) =>
    readNamedChannelDestination(viewer, viewerId, teamName, channelName);
  const outside = await inspect(otherTeam.name, "town-square");
  assert.ok(outside.kind === "join-team" && outside.team.id === otherTeam.id);
  assert.deepEqual(await inspect(closedTeam.name, "town-square"), {
    kind: "unavailable",
  });
  const destination = await inspect(team.name, publicRoom.name);
  assert.ok(
    destination.kind === "channel" &&
      destination.team.id === team.id &&
      destination.channel.id === publicRoom.id &&
      destination.channel.membership === "absent",
  );
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
  assert.deepEqual(await inspect(team.name, privateRoom.name), {
    kind: "unavailable",
  });
  assert.deepEqual(await inspect(team.name, "missing-named-route"), {
    kind: "unavailable",
  });
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
  const retired = await inspect(team.name, privateRoom.name);
  assert.ok(
    retired.kind === "channel" &&
      retired.channel.id === privateRoom.id &&
      retired.channel.archived &&
      retired.channel.membership === "member",
  );
  assert.ok(
    !(await teams.getTeamsForUser({ userId: "me" })).some(
      (row) => row.id === otherTeam.id,
    ),
  );
  await assert.rejects(read(privateRoom.name, false), missing);
}
