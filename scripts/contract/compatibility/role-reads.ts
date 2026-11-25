import assert from "node:assert/strict";
import { fetchTeamRoleSnapshot } from "../../../src/mattermost/channel-permissions.ts";
import {
  Configuration,
  ResponseError,
  RolesApi,
} from "../../../vendor/mattermost/index.js";

export async function checkRoleReads(
  basePath: string,
  accessToken: string,
  userId: string,
  version: string,
) {
  const config = new Configuration({ basePath, accessToken });
  const api = new RolesApi(config);
  const read = (names: string[]) => api.getRolesByNames({ requestBody: names });
  const result = await read([
    "system_user",
    "ummka_absent_role",
    "channel_user",
  ]);
  assert.ok(result);
  const roles = new Map(result.map((role) => [role.name, role]));
  assert.deepEqual([...roles.keys()].sort(), ["channel_user", "system_user"]);
  const channel = roles.get("channel_user");
  const system = roles.get("system_user");
  assert.ok(channel?.permissions);
  assert.ok(system?.permissions);
  assert.ok(channel.permissions.includes("create_post"));
  assert.ok(system.permissions.includes("create_direct_channel"));
  assert.ok(!system.permissions.includes("create_post"));
  assert.ok(channel.id && channel.displayName && channel.schemeManaged);
  assert.ok(system.id && system.id !== channel.id);

  const snapshot = await fetchTeamRoleSnapshot(config, userId, [
    "channel_user",
    "ummka_absent_role",
  ]);
  assert.ok(snapshot.systemRoles.split(" ").includes("system_user"));
  const saved = new Map(
    snapshot.definitions.map((role) => [role.name, role.permissions]),
  );
  assert.ok(saved.get("channel_user")?.includes("create_post"));
  assert.deepEqual(saved.get("ummka_absent_role"), []);
  assert.deepEqual(saved.get("system_user"), system.permissions);

  const names = Array.from({ length: 100 }, (_, i) => `ummka_absent_${i}`);
  assert.equal(await read(names), null);
  for (const invalid of [[], [...names, "channel_user"]]) {
    await assert.rejects(
      read(invalid),
      (error: unknown) =>
        error instanceof ResponseError && error.response.status === 400,
    );
  }
  await assert.rejects(
    new RolesApi(new Configuration({ basePath })).getRolesByNames({
      requestBody: ["channel_user"],
    }),
    (error: unknown) =>
      error instanceof ResponseError && error.response.status === 401,
  );
  console.log(
    `Mattermost ${version} verified role definitions as an ordinary user, missing roles, the 100-name limit and anonymous access.`,
  );
}
