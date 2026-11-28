import {
  type Configuration,
  FetchError,
  ResponseError,
  SharedChannelsApi,
  UsersApi,
} from "../../vendor/mattermost/index.js";
import { type ChannelProfile, channelProfile } from "./channel-profiles.ts";
import { isMattermostId } from "./model-fields.ts";
import type { ServerPolicy } from "./workspace-preferences.ts";

const pageSize = 100;
export type RecipientQuery =
  | { kind: "page"; page: number }
  | { kind: "search"; term: string };

export type RecipientPage = {
  profiles: ChannelProfile[];
  nextPage: number | null;
};
type RecipientPolicy = Pick<
  ServerPolicy,
  "dmRecipientScope" | "sharedChannelDMs"
>;

function predatesRemoteDmCheck(headers: Headers) {
  if (headers.has("cache-control")) return false;
  // Mattermost appends build, config hash and license fields to its release.
  const version =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:[.+-][\w-]+)*$/u.exec(
      headers.get("x-version-id") ?? "",
    );
  if (!version) return false;
  const major = Number(version[1]);
  return major < 10 || (major === 10 && Number(version[2]) < 11);
}

async function canMessageRemote(
  api: SharedChannelsApi,
  id: string,
  signal: AbortSignal,
) {
  try {
    const answer = await api.canUserDirectMessage(
      { userId: "me", otherUserId: id },
      { signal },
    );
    return answer?.canDm === true;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ResponseError && error.response.status !== 401) {
      void error.response.body?.cancel().catch(() => {});
      return false;
    }
    const failure = error instanceof FetchError ? error.cause : error;
    if (
      failure instanceof TypeError &&
      (failure.cause === undefined || failure.cause === "network")
    )
      return false;
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

export async function readConversationRecipients(
  config: Configuration,
  userId: string,
  teamId: string,
  query: RecipientQuery,
  readPolicy: () => Promise<RecipientPolicy | undefined>,
  signal?: AbortSignal,
  onLocalPage?: (page: RecipientPage) => void,
): Promise<RecipientPage> {
  signal?.throwIfAborted();
  if (!isMattermostId(userId) || !isMattermostId(teamId))
    throw TypeError("Invalid Mattermost recipient directory owner or team.");
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

  const { dmRecipientScope, sharedChannelDMs } = (await readPolicy()) ?? {};
  signal?.throwIfAborted();
  const team = dmRecipientScope === "any" ? undefined : teamId;
  const api = new UsersApi(config);
  const request =
    page !== null
      ? api.getUsersRaw(
          { active: true, page, perPage: pageSize, inTeam: team },
          { signal },
        )
      : api.searchUsersRaw(
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
  const { headers, rows } = await request
    .then(async (response) => {
      signal?.throwIfAborted();
      return { headers: response.raw.headers, rows: await response.value() };
    })
    .catch((error: unknown) => {
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
  const nextPage = page !== null && rows.length === pageSize ? page + 1 : null;
  const remoteIds = new Set(
    profiles
      .filter((profile, index) => profile.id !== userId && rows[index].remoteId)
      .map((profile) => profile.id),
  );
  if (
    !remoteIds.size ||
    (sharedChannelDMs === true && predatesRemoteDmCheck(headers))
  )
    return { profiles, nextPage };

  const localPage = {
    profiles: profiles.filter((profile) => !remoteIds.has(profile.id)),
    nextPage,
  };
  if (sharedChannelDMs !== true) return localPage;

  onLocalPage?.(localPage);
  const controller = new AbortController();
  const scope = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  const apiShared = new SharedChannelsApi(config);
  const pending = remoteIds.values();
  const allowed = new Set<string>();
  async function check() {
    try {
      for (const id of pending) {
        scope.throwIfAborted();
        if (await canMessageRemote(apiShared, id, scope)) allowed.add(id);
      }
    } catch (error) {
      controller.abort(error);
      throw error;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, remoteIds.size) }, check));
  scope.throwIfAborted();
  return {
    profiles: profiles.filter(
      (profile) => !remoteIds.has(profile.id) || allowed.has(profile.id),
    ),
    nextPage,
  };
}
