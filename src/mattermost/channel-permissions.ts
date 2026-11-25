import {
  type Configuration,
  RolesApi,
  type TeamMember,
  type User,
  UsersApi,
} from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";
import type { loadTeamDirectory } from "./navigation-data.ts";
import type { TeamSidebar } from "./team-sidebar.ts";

export type TeamRoleSnapshot = {
  systemRoles: string;
  definitions: { name: string; permissions: string[] }[];
};

type PermissionSource = {
  userId: string;
  user: Pick<User, "id" | "roles">;
  membership: TeamMember | undefined;
  directory: Pick<
    Awaited<ReturnType<typeof loadTeamDirectory>>,
    "teamId" | "channels"
  >;
};

function roleNames(roles: string | undefined) {
  if (typeof roles !== "string")
    throw new TypeError("Missing Mattermost role assignments.");
  return roles.split(" ").filter(Boolean);
}

type PermissionChannel = Pick<
  TeamSidebar["data"]["channels"][number],
  "kind" | "roles"
>;
export type ChannelPermission = "allowed" | "denied" | "unknown";
type Assignments = readonly string[] | undefined;

function isTeamChannel(kind: string | undefined) {
  return kind === "O" || kind === "P";
}

function assignedPermission(
  definitions: ReadonlyMap<string, ReadonlySet<string>>,
  scopes: readonly Assignments[],
  permission: string,
): ChannelPermission {
  let incomplete = false;
  for (const assignments of scopes) {
    if (assignments === undefined) {
      incomplete = true;
      continue;
    }
    for (const role of assignments) {
      const grants = definitions.get(role);
      if (grants?.has(permission)) return "allowed";
      if (!grants) incomplete = true;
    }
  }
  return incomplete ? "unknown" : "denied";
}

export function savedChannelPermissions(
  snapshot: TeamRoleSnapshot | null,
  teamRoles: string | undefined,
): (
  channel: PermissionChannel | "team" | undefined,
  permission: string,
) => ChannelPermission {
  if (!snapshot) return () => "unknown";
  const definitions = new Map(
    snapshot.definitions.map(({ name, permissions }) => [
      name,
      new Set(permissions),
    ]),
  );
  const system = roleNames(snapshot.systemRoles);
  const team = teamRoles === undefined ? undefined : roleNames(teamRoles);
  return (channel, permission) => {
    if (!channel) return "unknown";
    if (channel === "team")
      return assignedPermission(definitions, [system, team], permission);
    const local =
      channel.roles === undefined ? undefined : roleNames(channel.roles);
    const scopes = isTeamChannel(channel.kind)
      ? [system, team, local]
      : [system, local];
    return assignedPermission(definitions, scopes, permission);
  };
}

export async function loadChannelPermissions(
  config: Configuration,
  { userId, user, membership, directory }: PermissionSource,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const { teamId, channels } = directory;
  if (!isMattermostId(userId) || user.id !== userId || !isMattermostId(teamId))
    throw new TypeError("Invalid Mattermost permission scope.");
  if (
    membership &&
    (membership.userId !== userId ||
      membership.teamId !== teamId ||
      !isMattermostTime(membership.deleteAt, 0))
  )
    throw new TypeError("Invalid Mattermost team membership.");

  const systemRoles = roleNames(user.roles);
  const teamRoles =
    membership?.deleteAt === 0 ? roleNames(membership.roles) : [];
  const byChannel = new Map<string, { local: string[]; inherited: string[] }>();
  const requested = new Set<string>();
  const teamAndSystem = [...systemRoles, ...teamRoles];
  let hasTeamChannels = false;
  for (const { channel, membership: member } of channels) {
    const inTeam = isTeamChannel(channel.type) && channel.teamId === teamId;
    const direct =
      (channel.type === "D" || channel.type === "G") && channel.teamId === "";
    if (
      !isMattermostId(channel.id) ||
      byChannel.has(channel.id) ||
      (!inTeam && !direct) ||
      member.userId !== userId ||
      member.channelId !== channel.id
    )
      throw new TypeError("Invalid Mattermost channel membership.");
    const local = roleNames(member.roles);
    for (const name of local) requested.add(name);
    byChannel.set(channel.id, {
      local,
      inherited: inTeam ? teamAndSystem : systemRoles,
    });
    if (inTeam) hasTeamChannels = true;
  }
  if (byChannel.size) {
    for (const name of hasTeamChannels ? teamAndSystem : systemRoles)
      requested.add(name);
  }

  const permissions = await readRoleDefinitions(config, [...requested], signal);
  return (channelId: string, permission: string): boolean => {
    const assigned = byChannel.get(channelId);
    if (!assigned) return false;
    return (
      assignedPermission(
        permissions,
        [assigned.inherited, assigned.local],
        permission,
      ) === "allowed"
    );
  };
}

async function readRoleDefinitions(
  config: Configuration,
  names: string[],
  signal?: AbortSignal,
) {
  const api = new RolesApi(config);
  const permissions = new Map<string, Set<string>>();
  try {
    // Mattermost accepts at most 100 names in one POST /roles/names.
    for (let offset = 0; offset < names.length; offset += 100) {
      const batch = names.slice(offset, offset + 100);
      const roles = await api.getRolesByNames(
        { requestBody: batch },
        { signal },
      );
      signal?.throwIfAborted();
      const expected = new Set(batch);
      for (const role of roles ?? []) {
        if (
          !role.name ||
          !expected.delete(role.name) ||
          !Array.isArray(role.permissions) ||
          !role.permissions.every(
            (permission) =>
              typeof permission === "string" && permission.length > 0,
          )
        )
          throw new TypeError("Invalid Mattermost role definition.");
        permissions.set(role.name, new Set(role.permissions));
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
  return permissions;
}

export async function fetchTeamRoleSnapshot(
  config: Configuration,
  userId: string,
  assigned: readonly string[],
  signal?: AbortSignal,
): Promise<TeamRoleSnapshot> {
  signal?.throwIfAborted();
  if (!isMattermostId(userId))
    throw new TypeError("Invalid Mattermost permission scope.");
  let user: User;
  try {
    user = await new UsersApi(config).getUser({ userId: "me" }, { signal });
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
  signal?.throwIfAborted();
  if (user.id !== userId || typeof user.roles !== "string")
    throw new TypeError("Invalid Mattermost role owner.");
  const names = [...new Set([...assigned, ...roleNames(user.roles)])];
  const permissions = await readRoleDefinitions(config, names, signal);
  return {
    systemRoles: user.roles,
    definitions: names.map((name) => ({
      name,
      permissions: [...(permissions.get(name) ?? [])],
    })),
  };
}
