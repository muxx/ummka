import { expect, test } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import {
  fetchTeamRoleSnapshot,
  loadChannelPermissions,
  savedChannelPermissions,
} from "./channel-permissions.ts";

const userId = "u".repeat(26);
const teamId = "t".repeat(26);
const row = (id: string, type: string, roles: string) => ({
  channel: { id, type, teamId: type === "O" || type === "P" ? teamId : "" },
  membership: { userId, channelId: id, roles },
});
const open = row("o".repeat(26), "O", "reader writer absent");
const closed = row("p".repeat(26), "P", "reader");
const direct = row("d".repeat(26), "D", "reader");
const group = row("g".repeat(26), "G", "reader");
const source = {
  userId,
  user: { id: userId, roles: "system_user" },
  membership: { userId, teamId, roles: "team_special", deleteAt: 0 },
  directory: { teamId, channels: [open, closed, direct, group] },
};

function fixture(
  respond: (names: string[]) => Response = (names) =>
    Response.json(
      names
        .filter((name) => name !== "absent")
        .reverse()
        .map((name) => ({ name, permissions: [`grant_${name}`] })),
    ),
) {
  const calls: string[][] = [];
  const config = new Configuration({
    basePath: "https://fixture.test/sub",
    fetchApi: async (url, init) => {
      expect(String(url)).toBe("https://fixture.test/sub/api/v4/roles/names");
      expect(init?.method).toBe("POST");
      const names: string[] = JSON.parse(String(init?.body));
      calls.push(names);
      return respond(names);
    },
  });
  return { config, calls };
}

test("uses assigned system, team and channel roles and excludes team permissions in DMs and GMs", async () => {
  const { config, calls } = fixture();
  const allows = await loadChannelPermissions(config, source);
  for (const { channel } of source.directory.channels) {
    expect(allows(channel.id, "grant_system_user")).toBe(true);
    expect(allows(channel.id, "grant_reader")).toBe(true);
    expect(allows(channel.id, "grant_absent")).toBe(false);
    expect(allows(channel.id, "grant_team_special")).toBe(
      Boolean(channel.teamId),
    );
    expect(allows(channel.id, "grant_writer")).toBe(
      channel.id === open.channel.id,
    );
  }
  expect(allows("x".repeat(26), "grant_system_user")).toBe(false);
  expect(calls).toHaveLength(1);
  expect(calls[0].sort()).toEqual([
    "absent",
    "reader",
    "system_user",
    "team_special",
    "writer",
  ]);
});

test("ignores departed team roles, scopes with no channels, and unassigned roles", async () => {
  const { config, calls } = fixture();
  for (const membership of [undefined, { ...source.membership, deleteAt: 8 }]) {
    const allows = await loadChannelPermissions(config, {
      ...source,
      membership,
    });
    expect(allows(open.channel.id, "grant_team_special")).toBe(false);
    expect(allows(open.channel.id, "grant_system_user")).toBe(true);
  }
  expect(calls.flat()).not.toContain("team_special");
  const empty = fixture();
  await loadChannelPermissions(empty.config, {
    ...source,
    directory: { teamId, channels: [] },
  });
  const allows = await loadChannelPermissions(empty.config, {
    ...source,
    user: { id: userId, roles: "" },
    directory: { teamId, channels: [row(direct.channel.id, "D", "")] },
  });
  expect(allows(direct.channel.id, "grant_team_special")).toBe(false);
  expect(empty.calls).toEqual([]);
});

test("reads each distinct role only once in batches of up to 100 for an entire team", async () => {
  const { config, calls } = fixture();
  const roles = Array.from({ length: 205 }, (_, index) => `custom_${index}`);
  const channels = roles.map((role, index) =>
    row(String(index).padStart(26, "0"), "O", `reader ${role} reader`),
  );
  const allows = await loadChannelPermissions(config, {
    ...source,
    directory: { teamId, channels },
  });
  expect(calls.map((batch) => batch.length)).toEqual([100, 100, 8]);
  expect(new Set(calls.flat()).size).toBe(208);
  expect(allows(channels[204].channel.id, "grant_custom_204")).toBe(true);
  expect(allows(channels[17].channel.id, "grant_custom_204")).toBe(false);
});

test("an unmatched role batch grants no permission", async () => {
  const { config } = fixture(() => Response.json(null));
  const allows = await loadChannelPermissions(config, source);
  expect(allows(open.channel.id, "create_post")).toBe(false);
});

test("checks ownership and response identities before returning permissions", async () => {
  const { config, calls } = fixture();
  const foreignId = "f".repeat(26);
  for (const invalid of [
    { ...source, userId: foreignId },
    { ...source, membership: { ...source.membership, userId: foreignId } },
    { ...source, directory: { teamId: foreignId, channels: [open] } },
    {
      ...source,
      directory: {
        teamId,
        channels: [
          { ...open, membership: { ...open.membership, userId: foreignId } },
        ],
      },
    },
    { ...source, directory: { teamId, channels: [open, open] } },
  ])
    await expect(loadChannelPermissions(config, invalid)).rejects.toThrow(
      TypeError,
    );
  expect(calls).toEqual([]);
  for (const definitions of [
    [{ name: "unexpected", permissions: ["create_post"] }],
    [
      { name: "reader", permissions: [] },
      { name: "reader", permissions: ["create_post"] },
    ],
    [{ name: "reader" }],
    [{ name: "reader", permissions: "create_post" }],
    [{ name: "reader", permissions: [17] }],
  ]) {
    const bad = fixture(() => Response.json(definitions));
    await expect(loadChannelPermissions(bad.config, source)).rejects.toThrow(
      TypeError,
    );
  }
});

test("propagates a failed batch or a caller's cancellation without publishing partial permissions", async () => {
  const roles = Array.from({ length: 105 }, (_, i) => `custom_${i}`).join(" ");
  const many = { ...source, user: { id: userId, roles } };
  const interrupted = fixture((names) =>
    names.length === 100
      ? Response.json([])
      : new Response(null, { status: 503 }),
  );
  await expect(
    loadChannelPermissions(interrupted.config, many),
  ).rejects.toBeInstanceOf(ResponseError);
  expect(interrupted.calls).toHaveLength(2);
  const controller = new AbortController();
  const reason = new Error("Left the team");
  const stopped = fixture(() => {
    controller.abort(reason);
    return Response.json([]);
  });
  await expect(
    loadChannelPermissions(stopped.config, many, controller.signal),
  ).rejects.toBe(reason);
  await expect(
    loadChannelPermissions(stopped.config, many, controller.signal),
  ).rejects.toBe(reason);
  expect(stopped.calls).toHaveLength(1);
});

test("reads the signed-in user's roles once and records missing assignments in the complete snapshot", async () => {
  const assigned = Array.from({ length: 102 }, (_, i) => `assigned_${i}`);
  const requests: string[] = [];
  const batches: string[][] = [];
  const config = new Configuration({
    basePath: "https://fixture.test/chat",
    fetchApi: async (url, init) => {
      const path = new URL(String(url)).pathname;
      requests.push(path);
      if (path.endsWith("/users/me"))
        return Response.json({ id: userId, roles: "system_user assigned_0" });
      const names: string[] = JSON.parse(String(init?.body));
      batches.push(names);
      return Response.json(
        names.includes("system_user")
          ? [{ name: "system_user", permissions: ["read_channel"] }]
          : null,
      );
    },
  });
  const snapshot = await fetchTeamRoleSnapshot(config, userId, [
    ...assigned,
    "assigned_0",
  ]);
  expect(requests).toEqual([
    "/chat/api/v4/users/me",
    "/chat/api/v4/roles/names",
    "/chat/api/v4/roles/names",
  ]);
  expect(batches.map((batch) => batch.length)).toEqual([100, 3]);
  expect(snapshot.systemRoles).toBe("system_user assigned_0");
  expect(snapshot.definitions).toEqual([
    ...assigned.map((name) => ({ name, permissions: [] })),
    { name: "system_user", permissions: ["read_channel"] },
  ]);
});

test("a foreign profile, missing role assignments or an aborted profile read cannot publish permissions", async () => {
  for (const profile of [
    { id: teamId, roles: "system_admin" },
    { id: userId },
  ]) {
    const config = new Configuration({
      fetchApi: async (url) => {
        expect(String(url)).toMatch(/users\/me$/);
        return Response.json(profile);
      },
    });
    await expect(
      fetchTeamRoleSnapshot(config, userId, ["reader"]),
    ).rejects.toThrow(TypeError);
  }
  const abort = new AbortController();
  const reason = new Error("Changed team");
  const cancelled = new Configuration({
    fetchApi: async () => {
      abort.abort(reason);
      return Response.json({ id: userId, roles: "system_user" });
    },
  });
  await expect(
    fetchTeamRoleSnapshot(cancelled, userId, [], abort.signal),
  ).rejects.toBe(reason);
});

test("a saved permission distinguishes missing evidence from an explicitly empty role", () => {
  const snapshot = {
    systemRoles: "system",
    definitions: [
      { name: "system", permissions: ["read_channel"] },
      { name: "team", permissions: ["create_post"] },
      { name: "writer", permissions: ["attach_file"] },
      { name: "revoked", permissions: [] },
    ],
  };
  const check = savedChannelPermissions(snapshot, "team");
  expect(check("team", "read_channel")).toBe("allowed");
  expect(check("team", "create_post")).toBe("allowed");
  expect(check("team", "attach_file")).toBe("denied");
  expect(
    savedChannelPermissions(snapshot, undefined)("team", "create_post"),
  ).toBe("unknown");
  for (const kind of ["O", "P", "D", "G"]) {
    const room = { kind, roles: "writer revoked" };
    expect(check(room, "read_channel")).toBe("allowed");
    expect(check(room, "attach_file")).toBe("allowed");
    expect(check(room, "create_post")).toBe(
      ["O", "P"].includes(kind) ? "allowed" : "denied",
    );
    expect(check(room, "manage_system")).toBe("denied");
    expect(check({ ...room, roles: "new writer" }, "attach_file")).toBe(
      "allowed",
    );
    expect(check({ ...room, roles: "new writer" }, "manage_system")).toBe(
      "unknown",
    );
  }
  const old = savedChannelPermissions(snapshot, undefined);
  expect(old({ kind: "O" }, "read_channel")).toBe("allowed");
  expect(old({ kind: "O", roles: "writer" }, "create_post")).toBe("unknown");
  expect(old({ kind: "G", roles: "" }, "create_post")).toBe("denied");
  expect(old({ kind: "D" }, "create_post")).toBe("unknown");
  expect(check({ kind: "P", roles: "" }, "manage_system")).toBe("denied");
  expect(check(undefined, "read_channel")).toBe("unknown");
  expect(
    savedChannelPermissions(null, "team")(
      { kind: "O", roles: "writer" },
      "attach_file",
    ),
  ).toBe("unknown");
  expect(
    savedChannelPermissions({ systemRoles: "", definitions: [] }, "")(
      { kind: "P", roles: "" },
      "create_post",
    ),
  ).toBe("denied");
});
