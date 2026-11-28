import { expect, test, vi } from "vitest";
import { Configuration } from "../../vendor/mattermost/index.js";
import { readNamedChannelDestination } from "./named-channel-destination.ts";

const user = "u".repeat(26);
const team = {
  id: "t".repeat(26),
  type: "O",
  name: "engineering",
  display_name: "Engineering",
  delete_at: 0,
  allow_open_invite: true,
};
const room = {
  id: "c".repeat(26),
  team_id: team.id,
  type: "P",
  name: "build",
  display_name: "Build",
  delete_at: 0,
};
const member = { team_id: team.id, user_id: user, delete_at: 0 };
function fixture(...responses: Response[]) {
  const fetchApi = vi.fn<typeof fetch>(async (_url, options) => {
    expect(options?.method).toBe("GET");
    const next = responses.shift();
    if (!next) throw Error("Unexpected extra request");
    return next;
  });
  const config = new Configuration({
    basePath: "https://chat.example.test/prefix",
    fetchApi,
  });
  return {
    read: () => readNamedChannelDestination(config, user, team.name, room.name),
    fetchApi,
    config,
  };
}
const ok = (value: unknown) => Response.json(value);
const fail = (status: number) => Response.json({ id: "fixture" }, { status });

test("joining a new team can be confirmed before reading its channel", async () => {
  const { read, fetchApi } = fixture(
    ok(team),
    ok([{ ...member, delete_at: 14 }]),
  );
  expect(await read()).toEqual({
    kind: "join-team",
    team: { id: team.id, name: team.name, displayName: "Engineering" },
  });
  expect(fetchApi).toHaveBeenCalledTimes(2);
});
test("an invitation-only or constrained team cannot offer an open join", async () => {
  for (const fields of [
    { type: "I" },
    { group_constrained: true },
    { allow_open_invite: false },
  ]) {
    expect(await fixture(ok({ ...team, ...fields }), ok([])).read()).toEqual({
      kind: "unavailable",
    });
  }
});
test("hidden, missing and archived teams do not reveal a room", async () => {
  for (const reply of [fail(403), fail(404), ok({ ...team, delete_at: 130 })])
    expect(await fixture(reply).read()).toEqual({ kind: "unavailable" });
});
test("coordinates, membership and archive status describe the same signed destination", async () => {
  const { read, fetchApi } = fixture(
    ok(team),
    ok([member]),
    ok({ ...room, delete_at: 123 }),
    ok([{ user_id: user, channel_id: room.id }]),
  );
  expect(await read()).toMatchObject({
    kind: "channel",
    team: { id: team.id },
    channel: { id: room.id, type: "P", archived: true, membership: "member" },
  });
  expect(fetchApi.mock.calls.map(([url]) => String(url))).toEqual(
    [
      "teams/name/engineering",
      "users/me/teams/members",
      "teams/name/engineering/channels/name/build?include_deleted=true",
      `users/me/teams/${team.id}/channels/members`,
    ].map((path) => `https://chat.example.test/prefix/api/v4/${path}`),
  );
});
test("a response from another team or name and inconsistent membership rows fail", async () => {
  for (const fields of [
    { team_id: "x".repeat(26) },
    { name: "different" },
    { type: "D" },
    { delete_at: -1 },
  ])
    await expect(
      fixture(ok(team), ok([member]), ok({ ...room, ...fields })).read(),
    ).rejects.toThrow(TypeError);
  for (const rows of [
    [{ ...member, user_id: "x".repeat(26) }],
    [member, member],
  ])
    await expect(fixture(ok(team), ok(rows)).read()).rejects.toThrow(TypeError);
  await expect(fixture(ok({ ...team, name: "other" })).read()).rejects.toThrow(
    TypeError,
  );
});
test("access, partial responses and failures of membership reads remain distinct", async () => {
  expect(await fixture(ok(team), ok([member]), fail(404)).read()).toEqual({
    kind: "unavailable",
  });
  for (const replies of [
    [fail(401)],
    [fail(500)],
    [ok(team), fail(403)],
    [ok(team), ok([member]), ok(room), fail(404)],
  ])
    await expect(fixture(...replies).read()).rejects.toHaveProperty("response");
  await expect(
    fixture(Response.json(team, { status: 206 })).read(),
  ).rejects.toThrow(TypeError);
});
test("invalid input and an already cancelled read never reach transport", async () => {
  const { config, fetchApi } = fixture();
  await expect(
    readNamedChannelDestination(config, user, team.name, "../../me"),
  ).rejects.toThrow(TypeError);
  await expect(
    readNamedChannelDestination(
      config,
      user,
      team.name,
      room.name,
      AbortSignal.abort(),
    ),
  ).rejects.toHaveProperty("name", "AbortError");
  expect(fetchApi).not.toHaveBeenCalled();
});

test.each([403, 404, 206])(
  "releases an unread named destination response on HTTP %s",
  async (status) => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { status });
    const { read, fetchApi } = fixture(ok(team), ok([member]), response);
    if (status === 206) await expect(read()).rejects.toThrow(TypeError);
    else await expect(read()).resolves.toEqual({ kind: "unavailable" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchApi).toHaveBeenCalledTimes(3);
  },
);
