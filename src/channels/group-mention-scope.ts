import type { Group } from "../../vendor/mattermost/index.js";
import { isMattermostId } from "../mattermost/model-fields.ts";

type GroupPolicy = {
  canMentionGroups: boolean;
  ldapGroups: boolean;
  customGroups: boolean;
};

type Constrained = { groupConstrained?: boolean };

/** A null team belongs to a DM or GM. A missing snapshot flag needs a refresh. */
export function groupMentionScope(
  policy: GroupPolicy,
  channel: Constrained,
  team: Constrained | null,
) {
  if (!policy.canMentionGroups) return "none";
  if (!policy.ldapGroups) return policy.customGroups ? "directory" : "none";
  if (channel.groupConstrained === undefined) return "refresh-channel";
  if (channel.groupConstrained) return "channel";
  if (team === null) return "directory";
  if (team.groupConstrained === undefined) return "refresh-team";
  return team.groupConstrained ? "team" : "directory";
}

type GroupDirectory =
  | {
      scope: "directory";
      directory: readonly Group[];
    }
  | {
      scope: "channel" | "team";
      directory: readonly Group[];
      associated: readonly Group[];
    };

type MentionedGroup = { id: string; handle: string };

/** The directory always supplies custom groups. Synced groups follow the selected scope. */
export function matchGroupMentions(
  candidates: readonly string[],
  policy: GroupPolicy,
  rows: GroupDirectory,
): MentionedGroup[] {
  if (!candidates.length || !policy.canMentionGroups) return [];
  const byName = new Map<string, Group>();

  function add(group: Group) {
    if (group.name && group.deleteAt === 0 && group.allowReference === true)
      byName.set(group.name, group);
  }

  if (policy.customGroups)
    for (const group of rows.directory)
      if (group.source === "custom") add(group);
  if (policy.ldapGroups) {
    const synced =
      rows.scope === "directory" ? rows.directory : rows.associated;
    for (const group of synced)
      if (group.source === "ldap" || group.source?.startsWith("plugin_"))
        add(group);
  }

  const matched = new Map<string, MentionedGroup>();
  for (const candidate of candidates) {
    const word = candidate.toLowerCase();
    // Mattermost checks the full name first, then removes one trailing mark at a time.
    // The server limits group names to 64 ASCII characters.
    for (let length = word.length; length > 0; length--) {
      const handle = length <= 64 ? word.slice(0, length) : undefined;
      const group = handle === undefined ? undefined : byName.get(handle);
      if (group && handle !== undefined) {
        if (!isMattermostId(group.id))
          throw new TypeError("Invalid Mattermost group ID.");
        matched.set(group.id, { id: group.id, handle });
        break;
      }
      if (!".-_:".includes(word.charAt(length - 1))) break;
    }
  }
  return [...matched.values()];
}
