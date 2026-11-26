import assert from "node:assert/strict";
import { availableDirectoryChannels } from "../../../src/channels/open-channel-directory.ts";
import { openDirectorySearch } from "../../../src/channels/open-directory-search.ts";
import {
  readChannelDirectoryPage,
  searchChannelDirectory,
} from "../../../src/mattermost/channel-directory-page.ts";
import { loadTeamDirectory } from "../../../src/mattermost/navigation-data.ts";
import { changeOwnMembership } from "../../../src/mattermost/own-membership.ts";
import { projectTeamSidebar } from "../../../src/mattermost/team-sidebar.ts";
import {
  ChannelsApi,
  Configuration,
  ResponseError,
} from "../../../vendor/mattermost/index.js";
import { checkDirectoryQuery } from "./directory-query.ts";

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
          {
            team_id: teamId,
            name,
            display_name: name,
            type,
            header: "Current team topic",
            purpose: "Channel purpose",
          },
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
  const projected = await searchChannelDirectory(api, home, "  findable  ");
  const publicPage = await readChannelDirectoryPage(api, {
    teamId: home,
    kind: "public",
    page: 0,
  });
  for (const source of [publicPage.items, projected]) {
    const room = source.find((c) => c.id === open);
    assert.equal(room?.header, "Current team topic");
    assert.equal(room?.purpose, "Channel purpose");
  }
  console.log(
    `Mattermost ${version} verified nonmember topic and purpose in both public directory projections.`,
  );
  assert.deepEqual(
    projected.map((c) => [c.id, c.name, c.kind, c.deleteAt]),
    rows.map((c) => [c.id, c.name, c.type, c.deleteAt]),
  );
  assert.deepEqual(await searchChannelDirectory(api, home, "zzznomatches"), []);
  const search = openDirectorySearch(
    {
      searchChannelDirectory: (id, name, signal) =>
        searchChannelDirectory(api, id, name, signal),
    },
    home,
  );
  try {
    const match = await checkDirectoryQuery(search, "  findable  ");
    assert.deepEqual(match.items, projected);
    const empty = await checkDirectoryQuery(search, "zzznomatches");
    assert.deepEqual(empty.items, []);
  } finally {
    search.close();
  }
  console.log(
    `Mattermost ${version} verified an open directory query, ordered matches and an empty result.`,
  );
  const archived = await channel(home, "historic-search-fixture", "O");
  const headers = { Authorization: `Bearer ${admin}` };
  const deletion = await fetch(`${basePath}/api/v4/channels/${archived}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deletion.status, 200);
  await deletion.body?.cancel();
  async function checkArchive(included: boolean) {
    const items = await searchChannelDirectory(
      api,
      home,
      "historic-search-fixture",
    );
    assert.deepEqual(
      items.map((c) => c.id),
      included ? [archived] : [],
    );
    if (included) assert.ok(items[0].deleteAt > 0);
  }
  if (version === "10.10.1") {
    const response = await fetch(`${basePath}/api/v4/config`, { headers });
    assert.equal(response.status, 200);
    const original = (await response.json()).TeamSettings
      .ExperimentalViewArchivedChannels;
    assert.equal(typeof original, "boolean");
    async function setArchive(value: boolean) {
      const changed = await fetch(`${basePath}/api/v4/config/patch`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          TeamSettings: { ExperimentalViewArchivedChannels: value },
        }),
      });
      assert.equal(changed.status, 200);
      await changed.body?.cancel();
    }
    await checkArchive(original);
    try {
      await setArchive(!original);
      await checkArchive(!original);
    } finally {
      await setArchive(original);
    }
  } else {
    await checkArchive(true);
  }
  console.log(
    `Mattermost ${version} verified directory search projections, server order and archive visibility.`,
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
  const config = new Configuration({ basePath, accessToken: reader.token });
  async function memberIds() {
    const sidebar = projectTeamSidebar(
      await loadTeamDirectory(config, reader.id, home),
    );
    return new Set(sidebar.channels.map((room) => room.id));
  }
  const originalMembers = await memberIds();
  assert.deepEqual(
    availableDirectoryChannels(projected, originalMembers).map(
      (room) => room.id,
    ),
    [open],
  );
  const accepted = await changeOwnMembership(
    config,
    reader.id,
    { kind: "channel", id: open },
    "join",
  );
  assert.equal(accepted.kind, "applied");
  const currentMembers = await memberIds();
  assert.ok(currentMembers.has(open));
  assert.deepEqual(availableDirectoryChannels(projected, currentMembers), []);
  console.log(
    `Mattermost ${version} verified a directory join against the newly loaded team membership.`,
  );
  console.log(
    `Mattermost ${version} verified team-scoped directory search as an ordinary member of two teams.`,
  );
}
