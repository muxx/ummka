import {
  type Channel,
  type ChannelMember,
  ChannelsApi,
  type Configuration,
  type OrderedSidebarCategories,
  PreferencesApi,
  ResponseError,
  type Team,
  TeamsApi,
} from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

type DirectoryRequest = <T>(
  send: (options: { signal: AbortSignal }) => Promise<T>,
) => Promise<T>;

// Stop outstanding siblings on failure. The caller owns the failing response, including its body.
async function readDirectory<T>(
  signal: AbortSignal | undefined,
  read: (request: DirectoryRequest) => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  const pending = new Set<AbortController>();
  function cancel(reason: unknown) {
    for (const controller of pending) controller.abort(reason);
  }
  const abort = () => cancel(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const request: DirectoryRequest = async (send) => {
    signal?.throwIfAborted();
    const controller = new AbortController();
    pending.add(controller);
    try {
      return await send({ signal: controller.signal });
    } finally {
      pending.delete(controller);
    }
  };
  try {
    const result = await read(request);
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    cancel(error);
    throw signal?.aborted ? signal.reason : error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

function hasTeamIdentity(
  team: Team,
): team is Team & { id: string; name: string; displayName: string } {
  return (
    isMattermostId(team.id) &&
    typeof team.name === "string" &&
    typeof team.displayName === "string"
  );
}

export function loadAccountDirectory(
  config: Configuration,
  userId: string,
  signal?: AbortSignal,
) {
  return readDirectory(signal, async (request) => {
    if (!isMattermostId(userId))
      throw new TypeError("Invalid Mattermost account.");
    const api = new TeamsApi(config);
    const scope = { userId: "me" };
    const [teams, members, preferences] = await Promise.all([
      request((options) => api.getTeamsForUser(scope, options)),
      request((options) => api.getTeamMembersForUser(scope, options)),
      request((options) =>
        new PreferencesApi(config).getPreferences(scope, options),
      ),
    ]);
    const byTeam = new Map<string, (typeof members)[number]>();
    for (const member of members) {
      if (
        !isMattermostId(member.teamId) ||
        member.userId !== userId ||
        !isMattermostTime(member.deleteAt, 0) ||
        byTeam.has(member.teamId)
      )
        throw new TypeError("Invalid Mattermost team membership.");
      byTeam.set(member.teamId, member);
    }
    const seen = new Set<string>();
    const joined = teams.flatMap((team) => {
      if (
        !hasTeamIdentity(team) ||
        seen.has(team.id) ||
        !isMattermostTime(team.deleteAt, 0)
      )
        throw new TypeError("Invalid Mattermost team.");
      seen.add(team.id);
      const membership = byTeam.get(team.id);
      return team.deleteAt === 0 && membership?.deleteAt === 0
        ? [{ team, membership }]
        : [];
    });
    for (const preference of preferences) {
      if (
        preference.userId !== userId ||
        typeof preference.category !== "string" ||
        typeof preference.name !== "string" ||
        typeof preference.value !== "string"
      )
        throw new TypeError("Invalid Mattermost account preference.");
    }
    return { teams: joined, preferences };
  });
}

function joinedChannels(
  userId: string,
  teamId: string,
  channels: Channel[],
  members: ChannelMember[],
) {
  const byChannel = new Map<string, ChannelMember>();
  for (const member of members) {
    if (
      !isMattermostId(member.channelId) ||
      member.userId !== userId ||
      byChannel.has(member.channelId)
    )
      throw new TypeError("Invalid Mattermost channel membership.");
    byChannel.set(member.channelId, member);
  }
  const seen = new Set<string>();
  const joined = new Map<
    string,
    { channel: Channel; membership: ChannelMember }
  >();
  for (const channel of channels) {
    const inTeam =
      (channel.type === "O" || channel.type === "P") &&
      channel.teamId === teamId;
    const direct =
      (channel.type === "D" || channel.type === "G") && channel.teamId === "";
    if (
      !isMattermostId(channel.id) ||
      seen.has(channel.id) ||
      (!inTeam && !direct) ||
      !isMattermostTime(channel.deleteAt, 0) ||
      typeof channel.name !== "string" ||
      typeof channel.displayName !== "string"
    )
      throw new TypeError("Invalid Mattermost channel in team directory.");
    seen.add(channel.id);
    const membership = byChannel.get(channel.id);
    if (membership) joined.set(channel.id, { channel, membership });
  }
  return joined;
}

function orderedCategories(
  userId: string,
  teamId: string,
  sidebar: OrderedSidebarCategories,
  channels: ReadonlyMap<string, unknown>,
) {
  if (
    !Array.isArray(sidebar?.order) ||
    !Array.isArray(sidebar.categories) ||
    sidebar.categories.length !== sidebar.order.length
  )
    throw new TypeError("Invalid Mattermost sidebar order.");
  const categories = new Map<string, (typeof sidebar.categories)[number]>();
  for (const category of sidebar.categories) {
    const id = category.id;
    if (
      typeof id !== "string" ||
      !id ||
      categories.has(id) ||
      category.userId !== userId ||
      category.teamId !== teamId ||
      typeof category.displayName !== "string" ||
      typeof category.type !== "string" ||
      typeof category.sorting !== "string" ||
      !Number.isSafeInteger(category.sortOrder) ||
      typeof category.muted !== "boolean" ||
      typeof category.collapsed !== "boolean" ||
      !Array.isArray(category.channelIds)
    )
      throw new TypeError("Invalid Mattermost sidebar category.");
    const channelIds = category.channelIds.filter((channelId) => {
      if (!isMattermostId(channelId))
        throw new TypeError("Invalid channel ID in Mattermost sidebar.");
      return channels.has(channelId);
    });
    categories.set(id, { ...category, channelIds });
  }
  return sidebar.order.map((id) => {
    const category = categories.get(id);
    if (!category) throw new TypeError("Invalid Mattermost sidebar order.");
    categories.delete(id);
    return category;
  });
}

// This endpoint uses a specific AppError for zero rows, including when the team is visible.
async function emptyChannelList(error: unknown): Promise<Channel[]> {
  if (error instanceof ResponseError && error.response.status === 404) {
    const body = await error.response
      .clone()
      .json()
      .catch(() => null);
    if (body?.id === "app.channel.get_channels.not_found.app_error") return [];
  }
  throw error;
}

export function loadTeamDirectory(
  config: Configuration,
  userId: string,
  teamId: string,
  signal?: AbortSignal,
) {
  return readDirectory(signal, async (request) => {
    if (!isMattermostId(userId) || !isMattermostId(teamId))
      throw new TypeError("Invalid Mattermost account or team.");
    const api = new ChannelsApi(config);
    const scope = { userId: "me", teamId };
    const [channels, members, sidebar] = await Promise.all([
      request((options) =>
        api
          .getChannelsForTeamForUser(
            { ...scope, includeDeleted: true },
            options,
          )
          .catch(emptyChannelList),
      ),
      request((options) => api.getChannelMembersForUser(scope, options)),
      request((options) =>
        api.getSidebarCategoriesForTeamForUser(scope, options),
      ),
    ]);
    const joined = joinedChannels(userId, teamId, channels, members);
    return {
      teamId,
      channels: Array.from(joined.values()),
      categories: orderedCategories(userId, teamId, sidebar, joined),
    };
  });
}
