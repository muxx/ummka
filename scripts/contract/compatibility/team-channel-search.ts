import assert from "node:assert/strict";
import {
  ChannelsApi,
  Configuration,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkTeamChannelSearch(
  basePath: string,
  create: (route: string, body: object, token?: string) => Promise<Response>,
  admin: string,
  reader: { id: string; token: string },
  version: string,
) {
  const makeTeam = async (name: string) =>
    (
      await (
        await create("teams", { name, display_name: name, type: "I" }, admin)
      ).json()
    ).id as string;
  const home = await makeTeam("search-home");
  const neighbor = await makeTeam("search-neighbor");
  const outside = await makeTeam("search-outside");
  for (const teamId of [home, neighbor]) {
    await create(
      `teams/${teamId}/members`,
      { team_id: teamId, user_id: reader.id },
      admin,
    );
  }
  const channel = async (teamId: string, name: string, type: "O" | "P") =>
    (
      await (
        await create(
          "channels",
          { team_id: teamId, name, display_name: name, type },
          admin,
        )
      ).json()
    ).id as string;
  const open = await channel(home, "findable-public", "O");
  const own = await channel(home, "findable-private", "P");
  await channel(home, "findable-hidden", "P");
  const other = await channel(neighbor, "findable-public", "O");
  const inaccessible = await channel(outside, "findable-public", "O");
  assert.equal(new Set([open, other, inaccessible]).size, 3);
  assert.match(inaccessible, /^[a-z0-9]{26}$/iu);
  await create(`channels/${own}/members`, { user_id: reader.id }, admin);
  const api = new ChannelsApi(
    new Configuration({ basePath, accessToken: reader.token }),
  );
  const memberships = await api.getChannelsForTeamForUser({
    teamId: home,
    userId: "me",
  });
  assert.ok(!memberships.some((c) => c.id === open));
  const rows = await api.autocompleteChannelsForTeam({
    teamId: home,
    name: "findable",
  });
  assert.deepEqual(rows.map((c) => c.id).sort(), [own, open].sort());
  assert.ok(rows.every((c) => c.teamId === home));
  assert.equal(rows.find((c) => c.id === own)?.type, "P");
  assert.deepEqual(
    (
      await api.autocompleteChannelsForTeam({
        teamId: neighbor,
        name: "findable",
      })
    ).map((c) => c.id),
    [other],
  );
  assert.deepEqual(
    await api.autocompleteChannelsForTeam({
      teamId: home,
      name: "zzznomatches",
    }),
    [],
  );
  const anonymous = new ChannelsApi(new Configuration({ basePath }));
  for (const [client, teamId, status] of [
    [api, outside, 403],
    [anonymous, home, 401],
  ] as const) {
    await assert.rejects(
      client.autocompleteChannelsForTeam({ teamId, name: "findable" }),
      (error: unknown) =>
        error instanceof ResponseError && error.response.status === status,
    );
  }
  console.log(
    `Mattermost ${version} verified team-scoped directory search as an ordinary member of two teams.`,
  );
}
