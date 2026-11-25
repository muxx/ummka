import { expect, test } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { loadChannelPermissions } from "./channel-permissions.ts";

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
