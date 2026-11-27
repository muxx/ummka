import { type Configuration, UsersApi } from "../../vendor/mattermost/index.js";
import { channelProfile } from "./channel-profiles.ts";
import { isMattermostId } from "./model-fields.ts";
import type { ServerPolicy } from "./workspace-preferences.ts";

const pageSize = 100;
export type RecipientQuery =
  | { kind: "page"; page: number }
  | { kind: "search"; term: string };

export async function readConversationRecipients(
  config: Configuration,
  teamId: string,
  query: RecipientQuery,
  readScope: () => Promise<ServerPolicy["dmRecipientScope"]>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(teamId))
    throw TypeError("Invalid Mattermost recipient team.");
  const page = query.kind === "page" ? query.page : null;
  let term = "";
  if (query.kind === "page") {
    if (
      !Number.isSafeInteger(query.page) ||
      query.page < 0 ||
      query.page >= Number.MAX_SAFE_INTEGER
    ) {
      throw RangeError("Invalid Mattermost recipient page.");
    }
  } else if (query.kind === "search" && typeof query.term === "string") {
    term = query.term.trim().replace(/^@/u, "").trim();
    if (!term) throw TypeError("Missing Mattermost recipient search term.");
  } else throw TypeError("Invalid Mattermost recipient query.");

  const scope = await readScope();
  signal?.throwIfAborted();
  const team = scope === "any" ? undefined : teamId;
  const api = new UsersApi(config);
  const request =
    page !== null
      ? api.getUsers(
          { active: true, page, perPage: pageSize, inTeam: team },
          { signal },
        )
      : api.searchUsers(
          {
            searchUsersRequest: {
              term,
              teamId: team,
              allowInactive: false,
              limit: pageSize,
            },
          },
          { signal },
        );
  const rows = await request.catch((error: unknown) => {
    signal?.throwIfAborted();
    throw error;
  });
  signal?.throwIfAborted();
  if (!Array.isArray(rows) || rows.length > pageSize)
    throw TypeError("Invalid Mattermost recipient response.");
  const profiles = rows.map(channelProfile);
  if (
    profiles.some((profile) => profile.deleteAt !== 0) ||
    new Set(profiles.map((p) => p.id)).size !== profiles.length
  ) {
    throw TypeError("Invalid Mattermost recipient identities.");
  }
  return {
    profiles,
    nextPage: page !== null && rows.length === pageSize ? page + 1 : null,
  };
}
