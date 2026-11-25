import { invoke } from "@tauri-apps/api/core";
import { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";
import { expectCode } from "./local-history.ts";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
const teamId = "Team0123456789012345678901";
const data = {
  systemRoles: "system_user",
  definitions: [
    { name: "system_user", permissions: [] },
    { name: "fixture_writer", permissions: ["create_post"] },
  ],
};

export async function checkRoleStorage(
  account: Account,
  other: Account,
  userId: string,
) {
  const neighbor = await openAccountRestConnection(account.basePath, userId);
  try {
    const begin = (connection: Account) =>
      invoke<number | null>("begin_team_role_load", {
        rid: connection.rid,
        teamId,
      });
    const store = (connection: Account, load: number, snapshot: unknown) =>
      invoke<boolean>("store_team_roles", {
        rid: connection.rid,
        load,
        data: snapshot,
      });
    if ((await account.readSavedTeamRoles(teamId)) !== null)
      throw Error(
        "A newly published sidebar must start without an observed role snapshot",
      );
    const old = await begin(account);
    const current = await begin(neighbor);
    if (old === null || current === null) throw Error("Missing team role load");
    if (await store(account, old, data))
      throw Error("A newer window owns this role publication");
    await expectCode(store(other, current, data), "unknown_directory_load");
    if (!(await store(neighbor, current, data)))
      throw Error("Team role snapshot was not published");
    const invalid = await begin(account);
    const cancelled = await begin(neighbor);
    if (invalid === null || cancelled === null)
      throw Error("Missing replacement role load");
    await expectCode(
      store(account, invalid, { ...data, definitions: [] }),
      "invalid_directory",
    );
    await invoke("cancel_team_role_load", {
      rid: neighbor.rid,
      load: cancelled,
    });
    await expectCode(
      store(neighbor, cancelled, data),
      "unknown_directory_load",
    );
    await checkRestoredTeamRoles(account, true);
    await checkRestoredTeamRoles(other, false);
  } finally {
    await neighbor.close();
  }
}

export async function checkRestoredTeamRoles(account: Account, saved: boolean) {
  const snapshot = await account.readSavedTeamRoles(teamId);
  if (!saved) {
    if (snapshot !== null)
      throw Error("Role definitions crossed account boundaries");
    return;
  }
  if (
    snapshot?.systemRoles !== "system_user" ||
    snapshot.definitions.length !== 2 ||
    snapshot.definitions[0]?.name !== "system_user" ||
    snapshot.definitions[0].permissions.length ||
    snapshot.definitions[1]?.name !== "fixture_writer" ||
    snapshot.definitions[1].permissions.join() !== "create_post"
  )
    throw Error(
      "Offline role definitions did not survive reopening their own account",
    );
}
