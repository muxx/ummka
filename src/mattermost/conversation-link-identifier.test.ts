import { describe, expect, it, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { type ChannelsTarget, parseChannelsLink } from "./channels-link.ts";
import {
  type KnownChannelName,
  resolveConversationIdentifier,
} from "./conversation-link-identifier.ts";

const server = "https://chat.example.test/prefix";
const me = "m".repeat(26);
const peer = "p".repeat(26);
const room = "r".repeat(26);
const team = "t".repeat(26);
const hash = "a".repeat(40);
const known: KnownChannelName = {
  serverUrl: server,
  userId: me,
  team: "engineering",
  name: room,
  kind: "O",
};
function link(path: string) {
  const target = parseChannelsLink(server, `${server}/engineering/${path}`);
  if (target?.kind !== "conversation") throw Error("Invalid fixture link");
  return target;
}
function fixture(result?: Response) {
  const fetchApi = vi.fn<typeof fetch>(async () => {
    if (!result) throw Error("Unexpected request");
    return result;
  });
  const config = new Configuration({ basePath: server, fetchApi });
  return {
    fetchApi,
    classify: (path: string, hint?: KnownChannelName, signal?: AbortSignal) =>
      resolveConversationIdentifier(config, me, link(path), hint, signal),
  };
}
describe("conversation link identifiers", () => {
  it.each([
    ["channels/Release", { kind: "channel-name", name: "release" }],
    ["messages/@Ada%3Aremote", { kind: "username", name: "ada:remote" }],
    [
      "messages/Ada%40Example.test",
      { kind: "email", email: "ada@example.test" },
    ],
    [`messages/${peer}`, { kind: "user-id", id: peer }],
    [
      `messages/${peer.toUpperCase()}`,
      { kind: "user-id", id: peer.toUpperCase() },
    ],
    [`messages/@${"x".repeat(25)}`, { kind: "username", name: "x".repeat(25) }],
    [`messages/${hash}`, { kind: "group-name", name: hash }],
    ["messages/no-such-route", { kind: "unavailable" }],
    ["messages/@", { kind: "unavailable" }],
    [`channels/${hash}`, { kind: "group-name", name: hash }],
    [`channels/${me}__${peer}`, { kind: "user-id", id: peer }],
    [`channels/${peer}__${me}`, { kind: "user-id", id: peer }],
    [`channels/${me}__${me}`, { kind: "user-id", id: me }],
    [`channels/${peer}__${room}`, { kind: "unavailable" }],
    [
      `channels/${"a".repeat(25)}-`,
      { kind: "channel-name", name: `${"a".repeat(25)}-` },
    ],
  ] as const)("resolves %s without a request", async (path, want) => {
    const f = fixture();
    expect(await f.classify(path)).toEqual(want);
    expect(f.fetchApi).not.toHaveBeenCalled();
  });
  it("keeps exact names already known in the target account and team", async () => {
    const f = fixture();
    expect(await f.classify(`channels/${room}`, known)).toEqual({
      kind: "channel-name",
      name: room,
    });
    expect(
      await f.classify(`channels/${hash}`, { ...known, name: hash }),
    ).toEqual({ kind: "channel-name", name: hash });
    expect(
      await f.classify(`channels/${hash}`, { ...known, name: hash, kind: "G" }),
    ).toEqual({ kind: "group-name", name: hash });
    expect(f.fetchApi).not.toHaveBeenCalled();
  });
  it.each([
    { serverUrl: "https://elsewhere.test" },
    { userId: peer },
    { team: "sales" },
    { name: "other" },
  ])("ignores a different catalogue hint", async (change) => {
    const f = fixture(
      Response.json({ id: room, name: "other-room", type: "P", team_id: team }),
    );
    expect(
      await f.classify(`channels/${room}`, { ...known, ...change }),
    ).toEqual({
      kind: "channel-id",
      id: room,
      teamId: team,
      name: "other-room",
    });
    expect(
      f.fetchApi.mock.calls.map(([url, init]) => [url, init?.method]),
    ).toEqual([[`${server}/api/v4/channels/${room}`, "GET"]]);
  });
  it.each([
    [403, "unavailable"],
    [404, "channel-name"],
  ] as const)(
    "honors the server's %s decision and releases the body",
    async (status, kind) => {
      const cancel = vi.fn();
      const f = fixture(
        new Response(new ReadableStream({ cancel }), { status }),
      );
      expect(await f.classify(`channels/${room}`)).toMatchObject({ kind });
      expect(f.fetchApi).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );
  it.each([401, 429, 500])("retains HTTP %s", async (status) => {
    const cancel = vi.fn();
    const f = fixture(new Response(new ReadableStream({ cancel }), { status }));
    const lookup = f.classify(`channels/${room}`);
    await expect(lookup).rejects.toBeInstanceOf(ResponseError);
    await expect(lookup).rejects.toMatchObject({
      response: { status },
    });
    expect(f.fetchApi).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["D", `${me}__${peer}`, { kind: "user-id", id: peer }],
    ["G", hash, { kind: "group-name", name: hash }],
  ] as const)(
    "reads %s from the same by-ID response",
    async (type, name, want) => {
      const f = fixture(Response.json({ id: room, name, type, team_id: "" }));
      expect(await f.classify(`channels/${room}`)).toEqual(want);
      expect(f.fetchApi).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { id: peer },
    { team_id: "" },
    { name: "bad/name" },
    { type: "unknown" },
    { type: "D", name: `${room}__${peer}`, team_id: "" },
    { type: "G", name: "too-short", team_id: "" },
  ])("rejects inconsistent successful metadata", async (patch) => {
    await expect(
      fixture(
        Response.json({
          id: room,
          name: "release",
          type: "O",
          team_id: team,
          ...patch,
        }),
      ).classify(`channels/${room}`),
    ).rejects.toBeInstanceOf(TypeError);
  });
  it("binds the link to the connection before any read", async () => {
    const fetchApi = vi.fn<typeof fetch>();
    const config = new Configuration({
      basePath: "https://elsewhere.test",
      fetchApi,
    });
    await expect(
      resolveConversationIdentifier(config, me, link(`channels/${room}`)),
    ).rejects.toThrow(/this account/);
    expect(fetchApi).not.toHaveBeenCalled();
  });
  it("drops a completed lookup if its caller has cancelled", async () => {
    const controller = new AbortController();
    const target: Extract<ChannelsTarget, { kind: "conversation" }> = link(
      `channels/${room}`,
    );
    const config = new Configuration({
      basePath: server,
      fetchApi: async () => {
        controller.abort();
        return Response.json({
          id: room,
          name: "release",
          type: "O",
          team_id: team,
        });
      },
    });
    await expect(
      resolveConversationIdentifier(
        config,
        me,
        target,
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

it("releases an incomplete successful response without treating it as a missing name", async () => {
  const cancel = vi.fn();
  const incomplete = new Response(new ReadableStream({ cancel }), {
    status: 206,
  });
  await expect(
    fixture(incomplete).classify(`channels/${room}`),
  ).rejects.toThrow(/Incomplete/);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("probes the exact incoming ID before normalizing a missing channel's name", async () => {
  const incoming = room.toUpperCase();
  const f = fixture(new Response(null, { status: 404 }));
  expect(await f.classify(`channels/${incoming}`, known)).toEqual({
    kind: "channel-name",
    name: room,
  });
  expect(f.fetchApi.mock.calls.map(([url]) => String(url))).toEqual([
    `${server}/api/v4/channels/${incoming}`,
  ]);
});

it("rejects an ID reply that differs from the probed identifier only in case", async () => {
  const f = fixture(
    Response.json({ id: room, name: "release", type: "O", team_id: team }),
  );
  await expect(f.classify(`channels/${room.toUpperCase()}`)).rejects.toThrow(
    /Invalid Mattermost channel identity/,
  );
});
