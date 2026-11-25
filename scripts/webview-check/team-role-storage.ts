import { invoke } from "@tauri-apps/api/core";
import { savedChannelPermissions } from "../../src/mattermost/channel-permissions.ts";
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
      invoke<{ load: number; roleNames: string[] } | null>(
        "begin_team_role_load",
        {
          rid: connection.rid,
          teamId,
        },
      );
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
    if (current.roleNames.join() !== "channel_user,custom_writer,team_guest")
      throw Error(
        "The reserved role names do not match this team's saved memberships",
      );
    if (await store(account, old.load, data))
      throw Error("A newer window owns this role publication");
    await expectCode(
      store(other, current.load, data),
      "unknown_directory_load",
    );
    if (!(await store(neighbor, current.load, data)))
      throw Error("Team role snapshot was not published");
    const invalid = await begin(account);
    const cancelled = await begin(neighbor);
    if (invalid === null || cancelled === null)
      throw Error("Missing replacement role load");
    await expectCode(
      store(account, invalid.load, { ...data, definitions: [] }),
      "invalid_directory",
    );
    await invoke("cancel_team_role_load", {
      rid: neighbor.rid,
      load: cancelled.load,
    });
    await expectCode(
      store(neighbor, cancelled.load, data),
      "unknown_directory_load",
    );
    const before = await account.readSavedTeamRoles(teamId);
    if (before?.definitions[1]?.name !== "fixture_writer")
      throw Error("A failed or cancelled refresh erased the saved definitions");
    if (!(await account.refreshTeamRoles(teamId)))
      throw Error(
        "The active account did not publish refreshed role definitions",
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
  const permissions = new Map(
    snapshot?.definitions.map((role) => [role.name, role.permissions]),
  );
  if (
    snapshot?.systemRoles !== "system_user" ||
    permissions.size !== 4 ||
    permissions.get("system_user")?.join() !== "create_direct_channel" ||
    permissions.get("channel_user")?.join() !== "create_post" ||
    permissions.get("team_guest")?.length !== 0 ||
    permissions.get("custom_writer")?.length !== 0
  )
    throw Error(
      "The refreshed role definitions did not survive reopening their own account",
    );
  const [catalog, sidebar] = await Promise.all([
    account.readJoinedTeams(),
    account.readTeamSidebar(teamId),
  ]);
  const team = catalog?.teams.find((row) => row.id === teamId);
  const channel = sidebar?.data.channels[0];
  const check = savedChannelPermissions(snapshot, team?.roles);
  if (
    channel?.shared !== true ||
    check(channel, "create_post") !== "allowed" ||
    check(channel, "manage_system") !== "denied"
  )
    throw Error(
      "Offline channel permissions diverged from the saved assignments",
    );
}
