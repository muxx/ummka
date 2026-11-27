import { expect, test, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { readOwnChannelMembership } from "./own-channel-membership.ts";

const user = "u".repeat(26);
const team = "t".repeat(26);
const channel = "c".repeat(26);
const row = { user_id: user, channel_id: channel };
function fixture(body: unknown, status = 200) {
  const fetchApi = vi.fn<typeof fetch>(async () =>
    Response.json(body, { status }),
  );
  return {
    fetchApi,
    config: new Configuration({
      basePath: "https://chat.example.test/workspace",
      fetchApi,
    }),
  };
}

test.each([
  [[], "absent"],
  [[{ ...row, channel_id: "d".repeat(26) }], "absent"],
  [[{ ...row, channel_id: "d".repeat(26) }, row], "member"],
] as const)(
  "reads the complete signed membership list once",
  async (body, expected) => {
    const { config, fetchApi } = fixture(body);
    expect(await readOwnChannelMembership(config, user, team, channel)).toBe(
      expected,
    );
    expect(fetchApi).toHaveBeenCalledTimes(1);
    const [url, options] = fetchApi.mock.calls[0];
    expect(url).toBe(
      `https://chat.example.test/workspace/api/v4/users/me/teams/${team}/channels/members`,
    );
    expect(options?.method).toBe("GET");
    expect(options?.body).toBeUndefined();
  },
);

test.each([
  { name: "null", body: null },
  { name: "object", body: {} },
  { name: "null row", body: [row, null] },
  { name: "invalid channel", body: [row, { ...row, channel_id: "bad" }] },
  { name: "another member", body: [row, { ...row, user_id: "v".repeat(26) }] },
  { name: "duplicate", body: [row, row] },
])("rejects $name anywhere in the response", async ({ body }) => {
  const { config, fetchApi } = fixture(body);
  await expect(
    readOwnChannelMembership(config, user, team, channel),
  ).rejects.toThrow(TypeError);
  expect(fetchApi).toHaveBeenCalledTimes(1);
});

test.each([201, 206])(
  "rejects HTTP %i without publishing an absence",
  async (status) => {
    const cancel = vi.fn();
    const config = new Configuration({
      basePath: "https://chat.example.test/workspace",
      fetchApi: async () =>
        new Response(new ReadableStream({ cancel }), { status }),
    });
    await expect(
      readOwnChannelMembership(config, user, team, channel),
    ).rejects.toThrow("Incomplete");
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);
test.each([401, 403, 404, 500])(
  "preserves a server refusal or failure %i",
  async (status) => {
    const { config, fetchApi } = fixture(
      { id: "fixture.denied", status_code: status },
      status,
    );
    await expect(
      readOwnChannelMembership(config, user, team, channel),
    ).rejects.toBeInstanceOf(ResponseError);
    expect(fetchApi).toHaveBeenCalledTimes(1);
  },
);
test("checks all local identifiers and cancellation before requesting anything", async () => {
  const { config, fetchApi } = fixture([]);
  for (const [userId, teamId, channelId] of [
    ["bad", team, channel],
    [user, "bad", channel],
    [user, team, "bad"],
  ] as const)
    await expect(
      readOwnChannelMembership(config, userId, teamId, channelId),
    ).rejects.toThrow(TypeError);
  await expect(
    readOwnChannelMembership(config, user, team, channel, AbortSignal.abort()),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchApi).not.toHaveBeenCalled();
});
