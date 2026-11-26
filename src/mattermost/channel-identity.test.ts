import { expect, test, vi } from "vitest";
import { ChannelsApi, Configuration } from "../../vendor/mattermost/index.js";
import { readChannelIdentity } from "./channel-identity.ts";

const channelId = "c".repeat(26);
const teamId = "t".repeat(26);
const room = {
  id: channelId,
  type: "P",
  team_id: teamId,
  name: "ops",
  display_name: "Operations",
  delete_at: 123,
};
function fixture(reply: Response) {
  const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(reply);
  return {
    api: new ChannelsApi(
      new Configuration({ basePath: "https://example.test/chat", fetchApi }),
    ),
    fetchApi,
  };
}

test("reads the requested conversation in one signed connection route", async () => {
  const { api, fetchApi } = fixture(Response.json(room));
  const { signal } = new AbortController();
  await expect(readChannelIdentity(api, channelId, signal)).resolves.toEqual({
    id: channelId,
    kind: "P",
    teamId,
    name: "ops",
    displayName: "Operations",
    deleteAt: 123,
  });
  expect(fetchApi).toHaveBeenCalledExactlyOnceWith(
    "https://example.test/chat/api/v4/channels/" + channelId,
    expect.objectContaining({ method: "GET", signal }),
  );
});

test.each([
  { id: "x".repeat(26) },
  { team_id: "" },
  { type: "X" },
  { type: "D" },
  { type: "G" },
  { display_name: null },
  { display_name: "" },
  { name: "" },
  { delete_at: -1 },
])("rejects mismatched or malformed result identities %j", async (fields) => {
  const { api } = fixture(Response.json({ ...room, ...fields }));
  await expect(readChannelIdentity(api, channelId)).rejects.toThrow();
});

test("rejects invalid requests and cancellation before transport", async () => {
  const { api, fetchApi } = fixture(Response.json(room));
  await expect(readChannelIdentity(api, "short")).rejects.toThrow();
  await expect(
    readChannelIdentity(api, channelId, AbortSignal.abort()),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchApi).not.toHaveBeenCalled();
});

test("discards a partial success and closes its response body", async () => {
  const cancel = vi.fn();
  const { api } = fixture(
    new Response(new ReadableStream({ cancel }), { status: 206 }),
  );
  await expect(readChannelIdentity(api, channelId)).rejects.toThrow(
    "Incomplete",
  );
  expect(cancel).toHaveBeenCalledOnce();
});
