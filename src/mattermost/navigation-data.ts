import {
  type Configuration,
  PreferencesApi,
  TeamsApi,
} from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

// A directory is one result assembled from several independent server reads.
// Stop outstanding siblings if any read fails or the caller leaves the screen.
async function readDirectory<T>(
  signal: AbortSignal | undefined,
  read: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const result = await read(controller.signal);
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    controller.abort(error);
    throw signal?.aborted ? signal.reason : error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export function loadAccountDirectory(
  config: Configuration,
  userId: string,
  signal?: AbortSignal,
) {
  return readDirectory(signal, async (active) => {
    if (!isMattermostId(userId))
      throw new TypeError("Invalid Mattermost account.");
    const api = new TeamsApi(config);
    const scope = { userId: "me" };
    const options = { signal: active };
    const [teams, members, preferences] = await Promise.all([
      api.getTeamsForUser(scope, options),
      api.getTeamMembersForUser(scope, options),
      new PreferencesApi(config).getPreferences(scope, options),
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
        !isMattermostId(team.id) ||
        seen.has(team.id) ||
        !isMattermostTime(team.deleteAt, 0) ||
        typeof team.name !== "string" ||
        typeof team.displayName !== "string"
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
