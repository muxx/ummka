import { invoke } from "@tauri-apps/api/core";
import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";
import { effectiveWorkspacePreferences } from "../../src/mattermost/workspace-preferences.ts";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
export async function checkWorkspaceSettings(account: Account, other: Account) {
  const local = await account.readWorkspaceSettings();
  if (
    local.preferences?.limit !== 18 ||
    local.preferences.nameFormat !== "nickname_full_name" ||
    local.server !== null
  )
    throw Error("team refresh did not publish its preferences independently");
  const begin = () =>
    invoke<number>("begin_workspace_policy_load", { rid: account.rid });
  const old = await begin(),
    active = await begin();
  async function publish(rid: number, load: number, server: unknown) {
    return invoke<boolean>("store_workspace_policy", { rid, load, server });
  }
  const current = {
    collapsedThreads: "disabled",
    nameFormat: "username",
    lockNameFormat: false,
    separateUnreads: false,
  };
  if (await publish(account.rid, old, current))
    throw Error("late server policy accepted");
  async function rejected(action: Promise<unknown>, expected: string) {
    try {
      await action;
    } catch (error) {
      if (error === expected) return;
      throw error;
    }
    throw Error("server policy ticket was accepted unexpectedly");
  }
  await rejected(publish(other.rid, active, current), "unknown_directory_load");
  await rejected(
    publish(account.rid, active, { ...current, private: "not a policy field" }),
    "invalid_directory",
  );
  await rejected(
    publish(account.rid, active, current),
    "unknown_directory_load",
  );
  if (!(await account.refreshWorkspaceServerPolicy()))
    throw Error("server policy not published");
  const saved = await account.readWorkspaceSettings();
  if (!saved.server || !saved.preferences)
    throw Error("missing confirmed settings");
  const effective = effectiveWorkspacePreferences(
    saved.preferences,
    saved.server,
  );
  if (
    effective.nameFormat !== "full_name" ||
    !effective.collapsedThreads ||
    saved.server.dmRecipientScope !== "team" ||
    saved.server.userStatusesEnabled !== false ||
    effective.limit !== 18 ||
    effective.viewTimes["c".repeat(26)] !== 310 ||
    Object.hasOwn(effective.viewTimes, "historical-channel-key")
  )
    throw Error("server license and personal settings did not combine");
}
