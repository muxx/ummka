import assert from "node:assert/strict";
import { readChannelDirectoryPage } from "../../../src/mattermost/channel-directory-page.ts";
import {
  ChannelsApi,
  Configuration,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkChannelDirectoryPages(
  base: string,
  create: (route: string, body: object, token?: string) => Promise<Response>,
  admin: string,
  reader: { token: string; userId: string },
  version: string,
) {
  const team = async (name: string) =>
    (
      await (
        await create("teams", { name, display_name: name, type: "I" }, admin)
      ).json()
    ).id as string;
  const teamId = await team("browse-fixture");
  const otherId = await team("browse-neighbor");
  const channel = async (name: string, type: "O" | "P", scope = teamId) =>
    (
      await (
        await create(
          "channels",
          { team_id: scope, name, display_name: name, type },
          admin,
        )
      ).json()
    ).id as string;
  await create(
    `teams/${teamId}/members`,
    { team_id: teamId, user_id: reader.userId },
    admin,
  );
  const first = await channel("aaa-available", "O");
  const second = await channel("aab-available", "O");
  const publicArchive = await channel("old-public", "O");
  const ownArchive = await channel("own-private", "P");
  const hiddenArchive = await channel("hidden-private", "P");
  const neighbor = await channel("neighbor-room", "O", otherId);
  await create(
    `channels/${ownArchive}/members`,
    { user_id: reader.userId },
    admin,
  );
  for (const id of [publicArchive, ownArchive, hiddenArchive]) {
    const response = await fetch(`${base}/api/v4/channels/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${admin}` },
    });
    assert.equal(response.status, 200);
    await response.body?.cancel();
  }
  const api = new ChannelsApi(
    new Configuration({ basePath: base, accessToken: reader.token }),
  );
  const own = await api.getChannelsForTeamForUser({ userId: "me", teamId });
  assert.ok(!own.some((c) => c.id === first || c.id === second));
  const page = (page: number, perPage = 1) =>
    api.getPublicChannelsForTeam({ teamId, page, perPage });
  const all = await page(0, 100);
  const ids = all.map((c) => c.id);
  assert.ok(ids.includes(first) && ids.includes(second));
  assert.equal(new Set(ids).size, ids.length);
  for (const [index, expected] of ids.entries()) {
    assert.deepEqual(
      (await page(index)).map((c) => c.id),
      [expected],
    );
  }
  assert.deepEqual(await page(ids.length), []);
  assert.ok(
    all.every((c) => c.teamId === teamId && c.type === "O" && c.deleteAt === 0),
  );
  assert.ok(!all.some((c) => c.id === publicArchive || c.id === neighbor));
  const archived = await api.getDeletedChannelsForTeam({
    teamId,
    page: 0,
    perPage: 100,
  });
  assert.deepEqual(
    archived.map((c) => c.id),
    [publicArchive, ownArchive],
  );
  assert.deepEqual(
    archived.map((c) => c.type),
    ["O", "P"],
  );
  assert.ok(
    archived.every(
      (c) =>
        c.teamId === teamId && typeof c.deleteAt === "number" && c.deleteAt > 0,
    ),
  );
  assert.deepEqual(
    await api.getDeletedChannelsForTeam({ teamId, page: 2, perPage: 1 }),
    [],
  );
  for (const [kind, expected] of [
    ["public", all],
    ["archived", archived],
  ] as const) {
    const page = await readChannelDirectoryPage(api, { teamId, kind, page: 0 });
    assert.deepEqual(
      page.items.map((c) => [c.id, c.name, c.displayName, c.kind, c.deleteAt]),
      expected.map((c) => [c.id, c.name, c.displayName, c.type, c.deleteAt]),
    );
    assert.equal(page.hasMore, false);
    assert.deepEqual(
      await readChannelDirectoryPage(api, { teamId, kind, page: 1 }),
      { items: [], hasMore: false },
    );
    await assert.rejects(
      readChannelDirectoryPage(api, { teamId: otherId, kind, page: 0 }),
      (error: unknown) =>
        error instanceof ResponseError && error.response.status === 403,
    );
  }
  const anonymous = new ChannelsApi(new Configuration({ basePath: base }));
  for (const op of [
    "getPublicChannelsForTeam",
    "getDeletedChannelsForTeam",
  ] as const) {
    for (const [client, id, code] of [
      [api, otherId, 403],
      [anonymous, teamId, 401],
    ] as const) {
      await assert.rejects(
        client[op]({ teamId: id, page: 0, perPage: 50 }),
        (error: unknown) =>
          error instanceof ResponseError && error.response.status === code,
      );
    }
  }
  console.log(
    `Mattermost ${version} verified public and archived directory pages as an ordinary team member.`,
  );
}
