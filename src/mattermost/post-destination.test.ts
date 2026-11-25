import { expect, test, vi } from "vitest";
import { Configuration, PostsApi } from "../../vendor/mattermost/index.js";
import { readPostDestination } from "./post-destination.ts";

const post = "p".repeat(26),
  channel = "c".repeat(26),
  team = "t".repeat(26);
const raw = {
  channel_id: channel,
  channel_type: "O",
  channel_display_name: "Town Square",
  has_joined_channel: false,
  team_id: team,
  team_type: "I",
  team_display_name: "Polar",
  has_joined_team: true,
};
function fixture() {
  const fetchApi = vi.fn<typeof fetch>();
  const api = new PostsApi(
    new Configuration({
      basePath: "https://fixture.example.test/sub",
      fetchApi,
    }),
  );
  return { api, fetchApi };
}
test("a permalink target retains both memberships without joining anything", async () => {
  const { api, fetchApi } = fixture();
  fetchApi.mockResolvedValueOnce(Response.json(raw));
  expect(await readPostDestination(api, post)).toEqual({
    postId: post,
    channel: {
      id: channel,
      kind: "O",
      displayName: "Town Square",
      joined: false,
    },
    team: { id: team, kind: "I", displayName: "Polar", joined: true },
  });
  expect(fetchApi).toHaveBeenCalledTimes(1);
  expect(fetchApi.mock.calls[0][0]).toBe(
    `https://fixture.example.test/sub/api/v4/posts/${post}/info`,
  );
  expect(fetchApi.mock.calls[0][1]?.method).toBe("GET");
});
test.each(["D", "G"])("a %s conversation belongs to no team", async (kind) => {
  const { api, fetchApi } = fixture();
  fetchApi.mockResolvedValueOnce(
    Response.json({
      ...raw,
      channel_type: kind,
      channel_display_name: "",
      has_joined_channel: true,
      team_id: "",
      team_type: "",
      team_display_name: "",
      has_joined_team: false,
    }),
  );
  expect(await readPostDestination(api, post)).toEqual({
    postId: post,
    channel: { id: channel, kind, displayName: "", joined: true },
    team: null,
  });
});
test("private and missing posts produce the server's status and invalid context cannot navigate", async () => {
  const { api, fetchApi } = fixture();
  fetchApi.mockResolvedValueOnce(Response.json({}, { status: 404 }));
  await expect(readPostDestination(api, post)).rejects.toMatchObject({
    response: { status: 404 },
  });
  for (const body of [
    { ...raw, channel_type: "D" },
    { ...raw, team_id: "unknown" },
    { ...raw, has_joined_channel: "false" },
  ]) {
    fetchApi.mockResolvedValueOnce(Response.json(body));
    await expect(readPostDestination(api, post)).rejects.toThrow(TypeError);
  }
  await expect(readPostDestination(api, "bad")).rejects.toThrow(TypeError);
  expect(fetchApi).toHaveBeenCalledTimes(4);
});
test("abort before or after transport completion suppresses the destination", async () => {
  const { api, fetchApi } = fixture();
  const controller = new AbortController();
  fetchApi.mockImplementationOnce(async () => {
    controller.abort();
    return Response.json(raw);
  });
  await expect(
    readPostDestination(api, post, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    readPostDestination(api, post, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchApi).toHaveBeenCalledTimes(1);
});
