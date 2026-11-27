import { ResponseError, type UsersApi } from "../../vendor/mattermost/index.js";
import { channelProfile } from "./channel-profiles.ts";
import { isMattermostId } from "./model-fields.ts";
import type { SavedProfiles } from "./native-rest.ts";
import type { VisibleProfileQuery } from "./visible-profiles.ts";

export type ConversationRecipientTarget =
  | { kind: "user-id"; id: string }
  | { kind: "username"; name: string }
  | { kind: "email"; email: string };

export async function readConversationRecipient(
  users: UsersApi,
  target: ConversationRecipientTarget,
  readSaved: (query: VisibleProfileQuery) => Promise<SavedProfiles>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  let lookup = target;
  if (target.kind === "user-id") {
    if (!isMattermostId(target.id)) throw TypeError("Invalid recipient ID.");
  } else if (target.kind === "username") {
    if (
      typeof target.name !== "string" ||
      !/^[a-z0-9._:-]{1,64}$/u.test(target.name) ||
      target.name === "." ||
      target.name === ".."
    )
      throw TypeError("Invalid recipient username.");
    const known = await readSaved({ ids: [], usernames: [target.name] });
    signal?.throwIfAborted();
    if (Object.hasOwn(known.usernames, target.name)) {
      const id = known.usernames[target.name];
      if (
        !isMattermostId(id) ||
        known.profiles[id]?.id !== id ||
        known.profiles[id]?.username !== target.name
      )
        throw TypeError("Invalid saved recipient identity.");
      lookup = { kind: "user-id", id };
    }
  } else if (
    target.kind !== "email" ||
    typeof target.email !== "string" ||
    !/^[^@]+@[^@]+$/u.test(target.email) ||
    new TextEncoder().encode(target.email).length > 128
  ) {
    throw TypeError("Invalid recipient email.");
  }

  const options = { signal };
  try {
    const response =
      lookup.kind === "user-id"
        ? await users.getUserRaw({ userId: lookup.id }, options)
        : lookup.kind === "email"
          ? await users.getUserByEmailRaw({ email: lookup.email }, options)
          : await users.getUserByUsernameRaw(
              { username: lookup.name },
              options,
            );
    if (response.raw.status !== 200) {
      void response.raw.body?.cancel().catch(() => {});
      throw TypeError("Incomplete Mattermost recipient response.");
    }
    const user = await response.value();
    signal?.throwIfAborted();
    const profile = channelProfile(user);
    if (
      (lookup.kind === "user-id" && profile.id !== lookup.id) ||
      (target.kind === "username" && profile.username !== target.name) ||
      (target.kind === "email" && user.email !== target.email)
    )
      throw TypeError("Unexpected Mattermost recipient identity.");
    return profile;
  } catch (error) {
    signal?.throwIfAborted();
    if (
      !(error instanceof ResponseError) ||
      (error.response.status !== 403 && error.response.status !== 404)
    )
      throw error;
    void error.response.body?.cancel().catch(() => {});
    return null;
  }
}
