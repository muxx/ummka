// @vitest-environment node
import { expect, test, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { accountPostCollections } from "./account-post-collections.ts";

const channel = "c".repeat(26),
  team = "t".repeat(26),
  direct = "d".repeat(26);
const first = "a".repeat(26),
  last = "z".repeat(26);
const posts = {
  [first]: { id: first, channel_id: channel, message: "first" },
  [last]: { id: last, channel_id: direct, message: "last" },
};
const list = { posts, order: [last, first], first_inaccessible_post_time: 42 };
function fixture() {
  const fetchApi = vi.fn<typeof fetch>();
  const account = accountPostCollections(
    new Configuration({ basePath: "https://example.test/sub", fetchApi }),
    "u".repeat(26),
    (read) => read(),
  );
  return { fetchApi, account };
}

test("saved pages belong to me, keep server order across channels and preserve retention", async () => {
  const { fetchApi, account } = fixture();
  fetchApi.mockImplementation(async () => Response.json(list));
  const result = await account.readSavedPosts({ kind: "all" }, 3);
  expect(
    result.items.map((row) => [row.id, row.channelId, row.message]),
  ).toEqual([
    [last, direct, "last"],
    [first, channel, "first"],
  ]);
  expect(result.firstInaccessiblePostTime).toBe(42);
  await account.readSavedPosts({ kind: "team", teamId: team }, 0);
  const filtered = { ...list, order: [first] };
  fetchApi.mockResolvedValueOnce(Response.json(filtered));
  const inChannel = await account.readSavedPosts(
    { kind: "channel", channelId: channel },
    1,
  );
  expect(inChannel.items.map((row) => row.id)).toEqual([first]);
  for (const [i, filters] of [
    { page: "180", per_page: "60" },
    { team_id: team, page: "0", per_page: "60" },
    { channel_id: channel, page: "60", per_page: "60" },
  ].entries()) {
    const url = new URL(String(fetchApi.mock.calls[i][0]));
    expect(url.pathname).toBe("/sub/api/v4/users/me/posts/flagged");
    expect(Object.fromEntries(url.searchParams)).toEqual(filters);
  }
  expect(fetchApi).toHaveBeenCalledTimes(3);
});

test("pins request a single channel and only listed posts become rows", async () => {
  const { fetchApi, account } = fixture();
  const signal = new AbortController().signal;
  fetchApi.mockResolvedValueOnce(Response.json({ ...list, order: [first] }));
  const result = await account.readPinnedChannelPosts(channel, signal);
  expect(result.items.map((row) => row.id)).toEqual([first]);
  expect(fetchApi).toHaveBeenCalledExactlyOnceWith(
    `https://example.test/sub/api/v4/channels/${channel}/pinned`,
    expect.objectContaining({ method: "GET", signal }),
  );
});

test("refuses malformed rows, duplicate IDs, cross-channel rows and invalid retention", async () => {
  const { fetchApi, account } = fixture();
  for (const invalid of [
    { ...list, order: [first, first] },
    { ...list, order: [first], posts: {} },
    { ...list, order: [first], posts: { [first]: posts[last] } },
    {
      ...list,
      order: [first],
      posts: { [first]: { id: first, channel_id: "invalid" } },
    },
    { ...list, first_inaccessible_post_time: -1 },
    { posts, order: [] },
    { ...list, order: null },
  ]) {
    fetchApi.mockResolvedValueOnce(Response.json(invalid));
    await expect(account.readSavedPosts({ kind: "all" }, 0)).rejects.toThrow(
      TypeError,
    );
  }
  fetchApi.mockImplementation(async () => Response.json(list));
  await expect(
    account.readSavedPosts({ kind: "channel", channelId: channel }, 0),
  ).rejects.toThrow(TypeError);
  await expect(account.readPinnedChannelPosts(channel)).rejects.toThrow(
    TypeError,
  );
});

test("checks inputs before sending, keeps access refusals and empty pages distinct", async () => {
  const { fetchApi, account } = fixture();
  for (const page of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) {
    await expect(account.readSavedPosts({ kind: "all" }, page)).rejects.toThrow(
      RangeError,
    );
  }
  await expect(
    account.readSavedPosts({ kind: "team", teamId: "short" }, 0),
  ).rejects.toThrow(TypeError);
  await expect(
    account.readSavedPosts({ kind: "channel", channelId: "short" }, 0),
  ).rejects.toThrow(TypeError);
  await expect(account.readPinnedChannelPosts("short")).rejects.toThrow(
    TypeError,
  );
  const signal = AbortSignal.abort();
  await expect(
    account.readPinnedChannelPosts(channel, signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    account.readSavedPosts({ kind: "all" }, 0, signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchApi).not.toHaveBeenCalled();
  fetchApi.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(account.readPinnedChannelPosts(channel)).rejects.toBeInstanceOf(
    ResponseError,
  );
  fetchApi.mockResolvedValueOnce(
    Response.json({ posts: {}, order: [], first_inaccessible_post_time: 0 }),
  );
  await expect(account.readSavedPosts({ kind: "all" }, 4)).resolves.toEqual({
    items: [],
    firstInaccessiblePostTime: 0,
  });
});

test("counts only the current owner's flagged preferences and detects an invalid owner", async () => {
  const { fetchApi, account } = fixture();
  const owner = "u".repeat(26);
  const rows = [
    { user_id: owner, category: "flagged_post", name: first, value: "true" },
    {
      user_id: owner,
      category: "display_settings",
      name: "name_format",
      value: "username",
    },
    { user_id: owner, category: "flagged_post", name: last, value: "false" },
  ];
  fetchApi
    .mockResolvedValueOnce(Response.json(rows))
    .mockResolvedValueOnce(
      Response.json([{ ...rows[0], user_id: "x".repeat(26) }]),
    )
    .mockResolvedValueOnce(Response.json(null));
  expect(await account.readSavedPostUpperBound()).toBe(2);
  expect(String(fetchApi.mock.calls[0][0])).toBe(
    "https://example.test/sub/api/v4/users/me/preferences",
  );
  await expect(account.readSavedPostUpperBound()).rejects.toThrow();
  expect(await account.readSavedPostUpperBound()).toBe(0);
  for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    await expect(
      account.readSavedPostsAtOffset({ kind: "all" }, offset),
    ).rejects.toThrow();
  expect(fetchApi).toHaveBeenCalledTimes(3);
});
