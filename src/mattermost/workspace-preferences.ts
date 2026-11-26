import type { Preference } from "../../vendor/mattermost/index.js";
import { DirectoryValueError } from "./account-directory-error.ts";
import { locksTeammateName, normalizedNameFormat } from "./channel-profiles.ts";
import {
  assertAccountPreference,
  isMattermostId,
  isMattermostTime,
} from "./model-fields.ts";

type LicenseSettings = {
  LockTeammateNameDisplay?: string;
  IsLicensed?: string;
  LDAPGroups?: string;
};

type Settings = {
  EnableCrossTeamSearch?: string;
  EnableFileAttachments?: string;
  EnableFileSearch?: string;
  ExperimentalViewArchivedChannels?: string;
  UniqueEmojiReactionLimitPerPost?: string;
  PostEditTimeLimit?: string;
  MaxNotificationsPerChannel?: string;
  EnableConfirmNotificationsToChannel?: string;
  EnableCustomGroups?: string;
  CollapsedThreads?: string;
  FeatureFlagEnableSharedChannelsDMs?: string;
  ExperimentalGroupUnreadChannels?: string;
  TeammateNameDisplay?: string;
  LockTeammateNameDisplay?: string;
};

function count(value: string, field: "sidebar.limit" | "sidebar.time-value") {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new DirectoryValueError(field, "Invalid Mattermost sidebar number.");
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
  let sendOnCtrlEnter = false;
  let codeBlockOnCtrlEnter = true;
  for (const row of rows) {
    assertAccountPreference(row, userId);
    const { category, name, value } = row;
    if (category === "display_settings") {
      if (name === "name_format") nameFormat = value;
      if (name === "collapsed_reply_threads") threadMode = value;
    } else if (category === "advanced_settings") {
      if (name === "send_on_ctrl_enter") sendOnCtrlEnter = value !== "false";
      if (name === "code_block_ctrl_enter")
        codeBlockOnCtrlEnter = value !== "false";
    } else if (category === "sidebar_settings") {
      if (name === "limit_visible_dms_gms")
        limit = count(value, "sidebar.limit");
      if (name === "show_unread_section") unreads = value;
      if (name === "") oldUnreads = value;
    } else if (
      category === "direct_channel_show" ||
      category === "group_channel_show"
    ) {
      if (!isMattermostId(name))
        throw new DirectoryValueError(
          category === "direct_channel_show"
            ? "sidebar.direct-id"
            : "sidebar.group-id",
          "Invalid Mattermost conversation preference.",
        );
      const shown =
        category === "direct_channel_show" ? directShown : groupShown;
      if (value === "false") delete shown[name];
      else shown[name] = true;
    } else if (
      category === "channel_open_time" ||
      category === "channel_approximate_view_time"
    ) {
      // Mattermost reads these timestamps by channel.id. Other preference names cannot match a conversation.
      if (!isMattermostId(name)) continue;
      viewTimes[name] = Math.max(
        count(value, "sidebar.time-value"),
        viewTimes[name] ?? 0,
      );
    }
  }
  return {
    composerKeys: { sendOnCtrlEnter, codeBlockOnCtrlEnter },
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
type FreshPreferences = ReturnType<typeof sidebarPreferences>;
export type SidebarPreferences = Omit<FreshPreferences, "composerKeys"> & {
  composerKeys?: FreshPreferences["composerKeys"];
};

type MentionSettings = {
  confirmNotifications: boolean;
  maxNotificationsPerChannel: string;
  customGroups: boolean;
  ldapGroups: boolean;
};

function configFlag(value: string | undefined) {
  if (value === undefined) return undefined;
  if (value === "true" || value === "false") return value === "true";
  throw TypeError("Invalid Mattermost mention flag.");
}

function mentionSettings(
  config: Settings,
  license: LicenseSettings,
): MentionSettings | undefined {
  const limit = config.MaxNotificationsPerChannel;
  if (
    limit !== undefined &&
    (!/^[1-9][0-9]{0,18}$/.test(limit) || BigInt(limit) > 9223372036854775807n)
  )
    throw TypeError("Invalid Mattermost channel notification limit.");
  const confirmNotifications = configFlag(
    config.EnableConfirmNotificationsToChannel,
  );
  const customGroups = configFlag(config.EnableCustomGroups);
  const licensed = configFlag(license.IsLicensed);
  const ldap = configFlag(license.LDAPGroups);
  if (
    limit === undefined ||
    confirmNotifications === undefined ||
    customGroups === undefined ||
    licensed === undefined
  )
    return undefined;
  return {
    confirmNotifications,
    maxNotificationsPerChannel: limit,
    customGroups,
    ldapGroups: licensed && ldap === true,
  };
}

function signedLimit(raw: string | undefined, field: string) {
  if (raw === undefined) return undefined;
  if (/^-?(?:0|[1-9][0-9]{0,18})$/.test(raw) && raw !== "-0") {
    const value = BigInt(raw);
    if (value >= -9223372036854775808n && value <= 9223372036854775807n)
      return raw;
  }
  throw TypeError(`Invalid Mattermost ${field} limit.`);
}

export type ServerPolicy = {
  uniqueReactionLimit?: string;
  postEditLimitSeconds?: string;
  mentions?: MentionSettings;
  collapsedThreads: "disabled" | "always_on" | "default_on" | "default_off";
  separateUnreads: boolean;
  nameFormat: ReturnType<typeof normalizedNameFormat>;
  lockNameFormat: boolean;
  sharedChannelDMs?: boolean;
  search?: { allTeams: boolean; files: boolean; archivedChannels: boolean };
};
export function workspaceServerPolicy(
  config: Settings,
  license: LicenseSettings,
): ServerPolicy {
  const value = config.CollapsedThreads;
  // WebApp lets the user opt in to any defined mode other than disabled.
  const mode =
    value === undefined || value === "disabled"
      ? "disabled"
      : value === "always_on" || value === "default_on"
        ? value
        : "default_off";
  const mentions = mentionSettings(config, license);
  const uniqueReactionLimit = signedLimit(
    config.UniqueEmojiReactionLimitPerPost,
    "reaction",
  );
  const editLimit = signedLimit(config.PostEditTimeLimit, "post edit");
  const postEditLimitSeconds =
    license.IsLicensed === "false"
      ? "-1"
      : license.IsLicensed === "true"
        ? editLimit
        : undefined;
  return {
    ...(mentions && { mentions }),
    ...(postEditLimitSeconds !== undefined && { postEditLimitSeconds }),
    ...(uniqueReactionLimit !== undefined && { uniqueReactionLimit }),
    collapsedThreads: mode,
    separateUnreads: config.ExperimentalGroupUnreadChannels === "default_on",
    nameFormat: normalizedNameFormat(config.TeammateNameDisplay),
    lockNameFormat: locksTeammateName(config, license),
    search: {
      allTeams: config.EnableCrossTeamSearch === "true",
      files:
        config.EnableFileAttachments === "true" &&
        (config.EnableFileSearch === undefined ||
          config.EnableFileSearch === "true"),
      archivedChannels:
        config.ExperimentalViewArchivedChannels === undefined ||
        config.ExperimentalViewArchivedChannels === "true",
    },
    sharedChannelDMs: config.FeatureFlagEnableSharedChannelsDMs === "true",
  };
}

export function postEditWindow(
  server: ServerPolicy | null,
  createAt: number,
  now: number,
) {
  if (!isMattermostTime(createAt, 0) || !isMattermostTime(now, 0))
    throw TypeError("Invalid Mattermost post edit timestamp.");
  const limit = server?.postEditLimitSeconds;
  if (limit === undefined) return "unknown";
  if (limit === "-1") return "open";
  return BigInt(createAt) + BigInt(limit) * 1000n > BigInt(now)
    ? "open"
    : "expired";
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
  license: LicenseSettings,
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
