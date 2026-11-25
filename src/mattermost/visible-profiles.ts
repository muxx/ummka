import { type Configuration, UsersApi } from "../../vendor/mattermost/index.js";
import { type ChannelProfile, channelProfile } from "./channel-profiles.ts";
import { isMattermostId } from "./model-fields.ts";

export type VisibleProfileQuery = {
  ids: readonly string[];
  usernames: readonly string[];
};

// Same batch size as the official client's missing-profile reader.
const batchSize = 100;

export async function loadVisibleProfiles(
  config: Configuration,
  query: VisibleProfileQuery,
  signal?: AbortSignal,
): Promise<ChannelProfile[]> {
  signal?.throwIfAborted();
  const ids = [...new Set(query.ids)];
  const usernames = new Set(query.usernames);
  if (
    !ids.every(isMattermostId) ||
    [...usernames].some((name) => typeof name !== "string" || !name.trim())
  )
    throw new TypeError("Invalid requested profile identity.");

  const users = new UsersApi(config);
  const profiles = new Map<string, ChannelProfile>();
  async function read(keys: string[], kind: "id" | "username") {
    for (let index = 0; index < keys.length; index += batchSize) {
      signal?.throwIfAborted();
      const batch = keys.slice(index, index + batchSize);
      const request = { requestBody: batch };
      const rows =
        kind === "id"
          ? await users.getUsersByIds(request, { signal })
          : await users.getUsersByUsernames(request, { signal });
      signal?.throwIfAborted();
      const expected = new Set(batch);
      const received = new Set<string>();
      for (const row of rows) {
        const profile = channelProfile(row);
        if (!expected.delete(profile[kind]) || received.has(profile.id))
          throw new TypeError("Unexpected identity in the profile response.");
        received.add(profile.id);
        const previous = profiles.get(profile.id);
        if (!previous || (profile.updateAt ?? 0) >= (previous.updateAt ?? 0))
          profiles.set(profile.id, profile);
        if (kind === "id") usernames.delete(profile.username);
      }
    }
  }
  try {
    await read(ids, "id");
    await read([...usernames], "username");
    signal?.throwIfAborted();
    return [...profiles.values()];
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
}
