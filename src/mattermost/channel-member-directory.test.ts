import { expect, test, vi } from "vitest";
import { Configuration } from "../../vendor/mattermost/index.js";
import { readChannelMemberDirectory } from "./channel-member-directory.ts";

const channel = "c".repeat(26);
const id = (n: number) => String(n).padStart(26, "u");
function config(profiles: unknown, members: unknown) {
  const fetchApi = vi.fn<typeof fetch>(async (_url, init) =>
    Response.json(
      init?.method === "POST" && String(_url).endsWith("/members/ids")
        ? members
        : profiles,
    ),
  );
  return {
    api: new Configuration({
      basePath: "https://fixture.test/api-base",
      fetchApi,
    }),
    fetchApi,
  };
}
const profile = (n: number) => ({ id: id(n), username: "person" + n });
const membership = (n: number) => ({
  channel_id: channel,
  user_id: id(n),
  roles: "channel_user",
  scheme_admin: n === 2,
});
test("uses server order and confirmed channel membership, paging from the original page length", async () => {
  const all = Array.from({ length: 100 }, (_, i) => profile(i));
  const { api, fetchApi } = config(all, [membership(2), membership(0)]);
  const result = await readChannelMemberDirectory(api, channel, {
    kind: "page",
    page: 4,
  });
  expect(result.nextPage).toBe(5);
  expect(result.members.map((m) => [m.profile.id, m.schemeAdmin])).toEqual([
    [id(0), false],
    [id(2), true],
  ]);
  const url = new URL(String(fetchApi.mock.calls[0][0]));
  expect(Object.fromEntries(url.searchParams)).toEqual({
    page: "4",
    per_page: "100",
    in_channel: channel,
    sort: "admin",
  });
  expect(JSON.parse(String(fetchApi.mock.calls[1][1]?.body))).toEqual(
    all.map((p) => p.id),
  );
});
test("empty search is channel-scoped and does not read memberships", async () => {
  const { api, fetchApi } = config([], []);
  expect(
    await readChannelMemberDirectory(api, channel, {
      kind: "search",
      term: "  bird  ",
    }),
  ).toEqual({ members: [], nextPage: null });
  expect(fetchApi).toHaveBeenCalledOnce();
  expect(JSON.parse(String(fetchApi.mock.calls[0][1]?.body))).toEqual({
    in_channel_id: channel,
    term: "bird",
  });
});
test.each([
  [membership(1), membership(1)],
  [membership(99)],
  [{ ...membership(1), channel_id: "d".repeat(26) }],
])("rejects malformed membership batches", async (...members) => {
  const { api } = config([profile(1)], members);
  await expect(
    readChannelMemberDirectory(api, channel, { kind: "page", page: 0 }),
  ).rejects.toThrow("Invalid Mattermost channel member");
});
test("propagates a cancelled read before fetching memberships", async () => {
  const abort = new AbortController();
  const fetchApi = vi.fn<typeof fetch>(async () => {
    abort.abort();
    return Response.json([profile(1)]);
  });
  const api = new Configuration({ basePath: "https://fixture.test", fetchApi });
  await expect(
    readChannelMemberDirectory(
      api,
      channel,
      { kind: "page", page: 0 },
      abort.signal,
    ),
  ).rejects.toHaveProperty("name", "AbortError");
  expect(fetchApi).toHaveBeenCalledOnce();
});
