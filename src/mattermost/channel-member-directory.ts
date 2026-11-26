import {
  ChannelsApi,
  type Configuration,
  type User,
  UsersApi,
} from "../../vendor/mattermost/index.js";
import { channelProfile } from "./channel-profiles.ts";
import { isMattermostId } from "./model-fields.ts";

const pageSize = 100;
export type ChannelMemberQuery =
  | { kind: "page"; page: number }
  | { kind: "search"; term: string };

export async function readChannelMemberDirectory(
  config: Configuration,
  channelId: string,
  query: ChannelMemberQuery,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(channelId))
    throw TypeError("Invalid Mattermost channel ID.");
  const users = new UsersApi(config);
  let profiles: User[];
  if (query.kind === "page") {
    if (
      !Number.isSafeInteger(query.page) ||
      query.page < 0 ||
      query.page >= Number.MAX_SAFE_INTEGER
    )
      throw RangeError("Invalid channel member page.");
    profiles = await users.getUsers(
      {
        inChannel: channelId,
        page: query.page,
        perPage: pageSize,
        sort: "admin",
      },
      { signal },
    );
  } else {
    const term = query.term.trim();
    if (!term) throw TypeError("Missing channel member search term.");
    profiles = await users.searchUsers(
      { searchUsersRequest: { term, inChannelId: channelId } },
      { signal },
    );
  }
  signal?.throwIfAborted();
  if (
    !Array.isArray(profiles) ||
    (query.kind === "page" && profiles.length > pageSize)
  )
    throw TypeError("Invalid Mattermost channel profile list.");
  const ordered = profiles.map(channelProfile);
  const ids = new Set(ordered.map((profile) => profile.id));
  if (ids.size !== ordered.length)
    throw TypeError("Duplicate channel member profile.");
  const nextPage =
    query.kind === "page" && ordered.length === pageSize
      ? query.page + 1
      : null;
  const roles = new Map<
    string,
    { roles: string; schemeAdmin: boolean; schemeGuest: boolean }
  >();
  if (ordered.length) {
    const members = await new ChannelsApi(config).getChannelMembersByIds(
      { channelId, requestBody: [...ids] },
      { signal },
    );
    signal?.throwIfAborted();
    if (!Array.isArray(members))
      throw TypeError("Invalid Mattermost channel membership list.");
    for (const member of members) {
      if (
        member.channelId !== channelId ||
        !isMattermostId(member.userId) ||
        !ids.has(member.userId) ||
        roles.has(member.userId) ||
        typeof member.roles !== "string" ||
        (member.schemeAdmin !== undefined &&
          typeof member.schemeAdmin !== "boolean") ||
        (member.schemeGuest !== undefined &&
          typeof member.schemeGuest !== "boolean")
      )
        throw TypeError("Invalid Mattermost channel member.");
      roles.set(member.userId, {
        roles: member.roles,
        schemeAdmin: member.schemeAdmin === true,
        schemeGuest: member.schemeGuest === true,
      });
    }
  }
  // An account can leave after the profile query. Only return confirmed members.
  const members = ordered.flatMap((profile) => {
    const membership = roles.get(profile.id);
    return membership ? [{ profile, ...membership }] : [];
  });
  return { members, nextPage };
}
