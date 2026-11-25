import type { Preference } from "../../vendor/mattermost/index.js";
import { locksTeammateName, normalizedNameFormat } from "./channel-profiles.ts";
import { assertAccountPreference, isMattermostId } from "./model-fields.ts";

type Settings = {
  CollapsedThreads?: string;
  ExperimentalGroupUnreadChannels?: string;
  TeammateNameDisplay?: string;
  LockTeammateNameDisplay?: string;
};

function count(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw TypeError("Invalid Mattermost sidebar number.");
  return parsed;
}

function legacyUnreads(value: string) {
  const previous: unknown = JSON.parse(value);
  return (
    previous !== null &&
    typeof previous === "object" &&
    "unreads_at_top" in previous &&
    previous.unreads_at_top === "true"
  );
}

export function sidebarPreferences(
  userId: string,
  rows: readonly Preference[],
) {
  if (!isMattermostId(userId)) throw TypeError("Invalid Mattermost account.");
  const directShown: Record<string, true> = {};
  const groupShown: Record<string, true> = {};
  const viewTimes: Record<string, number> = {};
  let limit: number | null = null;
  let nameFormat: string | undefined;
  let threadMode: string | undefined;
  let unreads: string | undefined;
  let oldUnreads: string | undefined;
  for (const row of rows) {
    assertAccountPreference(row, userId);
    const { category, name, value } = row;
    if (category === "display_settings") {
      if (name === "name_format") nameFormat = value;
      if (name === "collapsed_reply_threads") threadMode = value;
    } else if (category === "sidebar_settings") {
      if (name === "limit_visible_dms_gms") limit = count(value);
      if (name === "show_unread_section") unreads = value;
      if (name === "") oldUnreads = value;
    } else if (
      category === "direct_channel_show" ||
      category === "group_channel_show"
    ) {
      if (!isMattermostId(name))
        throw TypeError("Invalid Mattermost conversation preference.");
      const shown =
        category === "direct_channel_show" ? directShown : groupShown;
      if (value === "false") delete shown[name];
      else shown[name] = true;
    } else if (
      category === "channel_open_time" ||
      category === "channel_approximate_view_time"
    ) {
      if (!isMattermostId(name))
        throw TypeError("Invalid Mattermost channel timestamp identity.");
      viewTimes[name] = Math.max(count(value), viewTimes[name] ?? 0);
    }
  }
  return {
    nameFormat:
      nameFormat === undefined ? null : normalizedNameFormat(nameFormat),
    collapsedThreads: threadMode === undefined ? null : threadMode === "on",
    separateUnreads: unreads
      ? unreads === "true"
      : oldUnreads
        ? legacyUnreads(oldUnreads)
        : null,
    limit,
    directShown,
    groupShown,
    viewTimes,
  };
}
export type SidebarPreferences = ReturnType<typeof sidebarPreferences>;

export type ServerPolicy = {
  collapsedThreads: "disabled" | "always_on" | "default_on" | "default_off";
  separateUnreads: boolean;
  nameFormat: ReturnType<typeof normalizedNameFormat>;
  lockNameFormat: boolean;
};
export function workspaceServerPolicy(
  config: Settings,
  license: Pick<Settings, "LockTeammateNameDisplay">,
): ServerPolicy {
  const value = config.CollapsedThreads;
  // WebApp lets the user opt in to any defined mode other than disabled.
  const mode =
    value === undefined || value === "disabled"
      ? "disabled"
      : value === "always_on" || value === "default_on"
        ? value
        : "default_off";
  return {
    collapsedThreads: mode,
    separateUnreads: config.ExperimentalGroupUnreadChannels === "default_on",
    nameFormat: normalizedNameFormat(config.TeammateNameDisplay),
    lockNameFormat: locksTeammateName(config, license),
  };
}

export type SavedWorkspaceSettings = {
  preferences: SidebarPreferences | null;
  server: ServerPolicy | null;
};

export function effectiveWorkspacePreferences(
  user: SidebarPreferences,
  server: ServerPolicy,
) {
  const mode = server.collapsedThreads;
  return {
    ...user,
    nameFormat: server.lockNameFormat
      ? server.nameFormat
      : (user.nameFormat ?? server.nameFormat),
    collapsedThreads:
      mode === "always_on" ||
      (mode !== "disabled" && (user.collapsedThreads ?? mode === "default_on")),
    separateUnreads: user.separateUnreads ?? server.separateUnreads,
  };
}

export function workspacePreferences(
  userId: string,
  rows: readonly Preference[],
  config: Settings,
  license: Pick<Settings, "LockTeammateNameDisplay">,
) {
  return effectiveWorkspacePreferences(
    sidebarPreferences(userId, rows),
    workspaceServerPolicy(config, license),
  );
}

export type WorkspacePreferences = ReturnType<typeof workspacePreferences>;

export function visibleConversationLimit(
  preferences: Pick<WorkspacePreferences, "limit">,
  compact: boolean,
) {
  return preferences.limit ?? (compact ? 20 : 40);
}
