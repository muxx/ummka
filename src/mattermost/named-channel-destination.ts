import {
  type ApiResponse,
  ChannelsApi,
  type Configuration,
  ResponseError,
  TeamsApi,
} from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";
import { indexOwnTeamMemberships } from "./navigation-data.ts";
import { readOwnChannelMembership } from "./own-channel-membership.ts";

function validName(value: string) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    !/[^a-zA-Z0-9_-]/u.test(value)
  );
}

async function complete<T>(request: Promise<ApiResponse<T>>) {
  const result = await request;
  if (result.raw.status !== 200) {
    await result.raw.body?.cancel().catch(() => {});
    throw new TypeError("Incomplete Mattermost link destination response.");
  }
  return result.value();
}

async function visible<T>(request: Promise<ApiResponse<T>>) {
  try {
    const value = await complete(request);
    if (!value) throw new TypeError("Missing Mattermost link destination.");
    return value;
  } catch (error) {
    if (
      error instanceof ResponseError &&
      (error.response.status === 403 || error.response.status === 404)
    ) {
      await error.response.body?.cancel().catch(() => {});
      return null;
    }
    throw error;
  }
}

export async function readNamedChannelDestination(
  config: Configuration,
  userId: string,
  teamName: string,
  channelName: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (
    !isMattermostId(userId) ||
    !validName(teamName) ||
    !validName(channelName)
  )
    throw new TypeError("Invalid Mattermost named channel address.");
  const teamSlug = teamName.toLowerCase();
  const channelSlug = channelName.toLowerCase();
  const teams = new TeamsApi(config);
  const row = await visible(
    teams.getTeamByNameRaw({ name: teamSlug }, { signal }),
  );
  signal?.throwIfAborted();
  const unavailable = { kind: "unavailable" } as const;
  if (!row) return unavailable;
  if (
    !isMattermostId(row.id) ||
    row.name !== teamSlug ||
    typeof row.displayName !== "string" ||
    !row.displayName ||
    (row.type !== "O" && row.type !== "I") ||
    !isMattermostTime(row.deleteAt, 0) ||
    (row.allowOpenInvite != null && typeof row.allowOpenInvite !== "boolean") ||
    (row.groupConstrained != null && typeof row.groupConstrained !== "boolean")
  )
    throw new TypeError("Invalid Mattermost team destination.");
  if (row.deleteAt > 0) return unavailable;
  const team = { id: row.id, name: row.name, displayName: row.displayName };
  const members = await complete(
    teams.getTeamMembersForUserRaw({ userId: "me" }, { signal }),
  );
  signal?.throwIfAborted();
  if (indexOwnTeamMemberships(members, userId).get(team.id)?.deleteAt !== 0) {
    return row.type === "O" &&
      row.allowOpenInvite === true &&
      row.groupConstrained !== true
      ? ({ kind: "join-team", team } as const)
      : unavailable;
  }
  const channel = await visible(
    new ChannelsApi(config).getChannelByNameForTeamNameRaw(
      { teamName: teamSlug, channelName: channelSlug, includeDeleted: true },
      { signal },
    ),
  );
  signal?.throwIfAborted();
  if (!channel) return unavailable;
  if (
    !isMattermostId(channel.id) ||
    channel.teamId !== team.id ||
    channel.name !== channelSlug ||
    typeof channel.displayName !== "string" ||
    !channel.displayName ||
    (channel.type !== "O" && channel.type !== "P") ||
    !isMattermostTime(channel.deleteAt, 0)
  )
    throw new TypeError("Invalid Mattermost channel destination.");
  const membership = await readOwnChannelMembership(
    config,
    userId,
    team.id,
    channel.id,
    signal,
  );
  signal?.throwIfAborted();
  return {
    kind: "channel",
    team,
    channel: {
      id: channel.id,
      name: channel.name,
      displayName: channel.displayName,
      type: channel.type,
      archived: channel.deleteAt > 0,
      membership,
    },
  } as const;
}
