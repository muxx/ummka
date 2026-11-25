import type { User } from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

function textField(value: string | undefined) {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new TypeError("Invalid profile text.");
  return value;
}

function timeField(value: number | undefined) {
  if (value === undefined) return null;
  if (!isMattermostTime(value, 0)) throw new TypeError("Invalid profile time.");
  return value;
}

export function channelProfile(user: User) {
  if (
    !isMattermostId(user.id) ||
    typeof user.username !== "string" ||
    !user.username.trim()
  )
    throw new TypeError("Invalid Mattermost profile identity.");
  if (user.isBot !== undefined && typeof user.isBot !== "boolean")
    throw new TypeError("Invalid Mattermost bot flag.");
  const remoteId = textField(user.remoteId);
  if (remoteId && !isMattermostId(remoteId))
    throw new TypeError("Invalid remote profile identity.");
  const alias =
    remoteId &&
    user.props &&
    typeof user.props === "object" &&
    "RemoteUsername" in user.props
      ? user.props.RemoteUsername
      : "";
  return {
    id: user.id,
    username: user.username,
    firstName: textField(user.firstName),
    lastName: textField(user.lastName),
    nickname: textField(user.nickname),
    position: textField(user.position),
    updateAt: timeField(user.updateAt),
    deleteAt: timeField(user.deleteAt),
    lastPictureUpdate: timeField(user.lastPictureUpdate),
    isBot: user.isBot === true,
    isGuest: textField(user.roles).split(" ").includes("system_guest"),
    remoteUsername: typeof alias === "string" ? alias : "",
  };
}

export type ChannelProfile = ReturnType<typeof channelProfile>;
export type NameFormat = "username" | "nickname_full_name" | "full_name";
type NameSettings = {
  TeammateNameDisplay?: string;
  LockTeammateNameDisplay?: string;
};

export function teammateNameFormat(
  config: NameSettings,
  license: Pick<NameSettings, "LockTeammateNameDisplay">,
  preference: string | undefined,
): NameFormat {
  return normalizedNameFormat(
    locksTeammateName(config, license) || preference === undefined
      ? config.TeammateNameDisplay
      : preference,
  );
}

export function locksTeammateName(
  config: NameSettings,
  license: Pick<NameSettings, "LockTeammateNameDisplay">,
) {
  return (
    license.LockTeammateNameDisplay === "true" &&
    config.LockTeammateNameDisplay === "true"
  );
}

export function normalizedNameFormat(value: string | undefined): NameFormat {
  return value === "nickname_full_name" || value === "full_name"
    ? value
    : "username";
}

export function teammateName(profile: ChannelProfile, format: NameFormat) {
  if (format === "username") {
    return profile.remoteUsername.trim()
      ? profile.remoteUsername
      : profile.username;
  }
  const full = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  const name =
    format === "nickname_full_name" && profile.nickname
      ? profile.nickname
      : full;
  return name.trim() ? name : profile.username;
}

export function directPartnerId(name: string, currentUserId: string) {
  const ids = name.split("__");
  if (ids.length !== 2 || !ids.every(isMattermostId)) return null;
  if (ids[0] === currentUserId) return ids[1];
  return ids[1] === currentUserId ? ids[0] : null;
}

export function indexChannelProfiles(
  profiles: readonly ChannelProfile[],
  matchedNames?: Readonly<Record<string, string>>,
) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const byUsername = new Map<string, ChannelProfile>();
  if (matchedNames) {
    // Offline lookup can return a requested ID while deliberately leaving its ambiguous username unresolved.
    for (const [name, id] of Object.entries(matchedNames)) {
      const profile = byId.get(id);
      if (profile?.username === name) byUsername.set(name, profile);
    }
  } else {
    const ambiguous = new Set<string>();
    for (const profile of byId.values()) {
      if (byUsername.has(profile.username)) ambiguous.add(profile.username);
      byUsername.set(profile.username, profile);
    }
    for (const name of ambiguous) byUsername.delete(name);
  }
  return { byId, byUsername };
}

const groupOrder = {
  en: new Intl.Collator("en", { numeric: true }),
  ru: new Intl.Collator("ru", { numeric: true }),
};
type Conversation = { kind: string; name: string; displayName: string };

export function conversationName(
  channel: Conversation,
  currentUserId: string,
  profiles: ReturnType<typeof indexChannelProfiles>,
  format: NameFormat,
  locale: "ru" | "en",
  memberIds?: ReadonlySet<string>,
) {
  if (channel.kind === "D") {
    const id = directPartnerId(channel.name, currentUserId);
    const person = id && profiles.byId.get(id);
    return person ? teammateName(person, format) : "";
  }
  if (channel.kind !== "G") return channel.displayName;

  let members = memberIds;
  if (!members) {
    const ids = new Set<string>();
    for (const username of channel.displayName.split(", ")) {
      const user = profiles.byUsername.get(username);
      if (!user || ids.has(user.id)) return channel.displayName;
      ids.add(user.id);
    }
    members = ids;
  }
  const names: string[] = [];
  for (const id of members) {
    if (id === currentUserId) continue;
    const person = profiles.byId.get(id);
    names.push(
      person
        ? teammateName(person, format)
        : locale === "ru"
          ? "Кто-то"
          : "Someone",
    );
  }
  return names.sort(groupOrder[locale].compare).join(", ");
}
