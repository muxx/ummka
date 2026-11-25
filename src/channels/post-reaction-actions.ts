import type { Reaction } from "../../vendor/mattermost/index.js";
import type { ChannelPermission } from "../mattermost/channel-permissions.ts";

type Badge = { count: number; own: boolean };
type Row = Pick<Reaction, "postId" | "userId" | "emojiName">;

/** Build once per post snapshot, for both the badges and composer shortcuts. */
export function postReactionBadges(
  postId: string,
  userId: string,
  rows: readonly Row[],
): ReadonlyMap<string, Readonly<Badge>> {
  const badges = new Map<string, Badge>();
  for (const row of rows) {
    if (row.postId !== postId)
      throw new TypeError("Reactions belong to a different post.");
    const badge = badges.get(row.emojiName);
    if (badge) {
      badge.count++;
      if (row.userId === userId) badge.own = true;
    } else {
      badges.set(row.emojiName, { count: 1, own: row.userId === userId });
    }
  }
  return badges;
}

type Access = {
  online: boolean;
  archived: boolean;
  add: ChannelPermission;
  remove: ChannelPermission;
  uniqueLimit?: number;
};
export function postReactionDecision(
  badges: ReadonlyMap<string, Readonly<Badge>>,
  emojiName: string,
  request: "add" | "remove" | "toggle",
  access: Access,
) {
  const badge = badges.get(emojiName);
  const action =
    request === "toggle" ? (badge?.own ? "remove" : "add") : request;
  if (!access.online) return "offline";
  if (access.archived) return "archived";
  if (access[action] === "unknown") return "permissionUnknown";
  if (access[action] === "denied") return "permissionDenied";
  if (action === "remove") return badge?.own ? "remove" : "notAdded";
  if (badge?.own) return "alreadyAdded";
  if (badge) return "add";
  if (
    access.uniqueLimit === undefined ||
    !Number.isSafeInteger(access.uniqueLimit)
  )
    return "limitUnknown";
  return badges.size >= access.uniqueLimit ? "limitReached" : "add";
}
