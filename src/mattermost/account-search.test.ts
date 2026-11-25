// @vitest-environment node
import { expect, test, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { accountSearch } from "./account-search.ts";

const team = "t".repeat(26),
  c = "c".repeat(26),
  first = "a".repeat(26),
  second = "b".repeat(26);
const params = {
  teamId: team,
  terms: "from:teammate  polar",
  isOrSearch: false,
  includeDeletedChannels: true,
  timeZoneOffsetSeconds: -10800,
  page: 0,
};
const posts = {
  order: [second, first],
  posts: {
    [first]: { id: first, channel_id: c, message: "A" },
    [second]: { id: second, channel_id: c, message: "B" },
  },
  matches: null,
  prev_post_id: "",
  next_post_id: "",
  first_inaccessible_post_time: 42,
};
const files = {
  order: [first],
  file_infos: {
    [first]: {
      id: first,
      channel_id: c,
      user_id: "bookmark",
      name: "Bookmark.pdf",
      archived: false,
    },
  },
  prev_file_info_id: "",
  next_file_info_id: "",
  first_inaccessible_file_time: 25,
};
function fixture() {
  const fetchApi = vi.fn<typeof fetch>();
  const account = accountSearch(
    new Configuration({ basePath: "https://fixture.test/subpath", fetchApi }),
    (read) => read(),
  );
  return { fetchApi, account };
}
test("the account requests the selected scope, preserves filters and follows server order until an empty page", async () => {
  const { fetchApi, account } = fixture();
  fetchApi
    .mockResolvedValueOnce(Response.json(posts))
    .mockResolvedValueOnce(
      Response.json({ ...posts, order: [], posts: {}, matches: {} }),
    );
  const result = await account.readPostSearchPage(params);
  expect(result.items.map(({ id }) => id)).toEqual([second, first]);
  expect(result).toMatchObject({
    matches: null,
    isEnd: false,
    firstInaccessiblePostTime: 42,
  });
  const end = await account.readPostSearchPage({
    ...params,
    teamId: null,
    page: 1,
  });
  expect(end).toMatchObject({ items: [], matches: {}, isEnd: true });
  expect(fetchApi.mock.calls.map(([url]) => url)).toEqual([
    `https://fixture.test/subpath/api/v4/teams/${team}/posts/search`,
    "https://fixture.test/subpath/api/v4/posts/search",
  ]);
  expect(JSON.parse(String(fetchApi.mock.calls[1][1]?.body))).toEqual({
    terms: params.terms,
    is_or_search: false,
    include_deleted_channels: true,
    time_zone_offset: -10800,
    page: 1,
    per_page: 20,
  });
});
test("bookmark files retain their own identity, and attached files retain the post to open", async () => {
  const { account, fetchApi } = fixture();
  fetchApi.mockResolvedValueOnce(Response.json(files)).mockResolvedValueOnce(
    Response.json({
      ...files,
      file_infos: {
        [first]: { ...files.file_infos[first], post_id: second },
      },
    }),
  );
  const bookmark = await account.readFileSearchPage({
    ...params,
    teamId: null,
  });
  expect(bookmark).toMatchObject({
    isEnd: false,
    firstInaccessibleFileTime: 25,
    items: [{ id: first, channelId: c, userId: "bookmark", postId: null }],
  });
  expect((await account.readFileSearchPage(params)).items[0].postId).toBe(
    second,
  );
  expect(fetchApi.mock.calls.map(([url]) => url)).toEqual([
    "https://fixture.test/subpath/api/v4/files/search",
    `https://fixture.test/subpath/api/v4/teams/${team}/files/search`,
  ]);
});
test("results with missing identities, malformed highlights or pagination are rejected", async () => {
  const { account, fetchApi } = fixture();
  for (const invalid of [
    { ...params, teamId: "bad" },
    { ...params, page: -1 },
    { ...params, timeZoneOffsetSeconds: Infinity },
    { ...params, terms: "" },
  ])
    await expect(account.readPostSearchPage(invalid)).rejects.toThrow();
  expect(fetchApi).not.toHaveBeenCalled();
  for (const answer of [
    { ...posts, posts: {} },
    { ...posts, matches: { [first]: 3 } },
    { ...posts, first_inaccessible_post_time: -1 },
  ]) {
    fetchApi.mockResolvedValueOnce(Response.json(answer));
    await expect(account.readPostSearchPage(params)).rejects.toThrow();
  }
  fetchApi.mockResolvedValueOnce(
    Response.json({
      ...files,
      file_infos: { [first]: { id: first, channel_id: c, post_id: "broken" } },
    }),
  );
  await expect(account.readFileSearchPage(params)).rejects.toThrow();
});
test("HTTP failures stay observable and a cancelled response is never delivered", async () => {
  const { account, fetchApi } = fixture();
  fetchApi.mockResolvedValueOnce(Response.json({}, { status: 501 }));
  await expect(account.readFileSearchPage(params)).rejects.toBeInstanceOf(
    ResponseError,
  );
  const controller = new AbortController();
  fetchApi.mockImplementationOnce(async () => {
    controller.abort();
    return Response.json(posts);
  });
  await expect(
    account.readPostSearchPage(params, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    account.readFileSearchPage(params, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchApi).toHaveBeenCalledTimes(2);
});
