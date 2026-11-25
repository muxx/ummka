import assert from "node:assert/strict";
import { accountSearch } from "../../../src/mattermost/account-search.ts";
import {
  ChannelsApi,
  Configuration,
  PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkPostSearch(
  session: Configuration,
  readerSession: Configuration,
  teamId: string,
  channelId: string,
  otherTeamId: string,
  version: string,
) {
  const channels = await new ChannelsApi(session).getChannelsForTeamForUser({
    userId: "me",
    teamId: otherTeamId,
  });
  const other = channels.find((c) => c.name === "town-square");
  assert.ok(other?.id);
  const owner = new PostsApi(session),
    reader = new PostsApi(readerSession);
  const terms = "ummkasearchfixture";
  const write = (id: string, text: string) =>
    owner.createPost({
      createPostRequest: { channelId: id, message: terms + " " + text },
    });
  const first = await write(channelId, "first"),
    second = await write(other.id, "second");
  assert.ok(first.id && second.id);
  const params = {
    terms,
    isOrSearch: false,
    timeZoneOffset: 0,
    includeDeletedChannels: false,
    page: 0,
    perPage: 40,
  };
  const all = (posts: PostsApi) =>
    posts.searchPostsInAllTeams({ searchPostsInAllTeamsRequest: params });
  const scope = (posts: PostsApi, id: string) =>
    posts.searchPosts({ teamId: id, searchPostsRequest: params });
  const initial = await scope(owner, teamId);
  assert.deepEqual(initial.order, [first.id]);
  assert.equal(initial.posts[first.id].channelId, channelId);
  assert.equal(initial.firstInaccessiblePostTime, 0);
  assert.equal(initial.nextPostId, "");
  assert.equal(initial.prevPostId, "");
  assert.equal(initial.matches, null);
  assert.deepEqual((await scope(owner, otherTeamId)).order, [second.id]);
  assert.deepEqual(
    new Set((await all(owner)).order),
    new Set([first.id, second.id]),
  );
  assert.deepEqual((await all(reader)).order, [first.id]);
  assert.deepEqual((await scope(reader, teamId)).order, [first.id]);
  await assert.rejects(
    scope(reader, otherTeamId),
    (e: unknown) => e instanceof ResponseError && e.response.status === 403,
  );
  const empty = await owner.searchPostsInAllTeams({
    searchPostsInAllTeamsRequest: { ...params, terms: "ummkanosuchfixture" },
  });
  assert.deepEqual(empty.order, []);
  assert.deepEqual(empty.posts, {});
  const anon = new PostsApi(new Configuration({ basePath: session.basePath }));
  await assert.rejects(
    all(anon),
    (e: unknown) => e instanceof ResponseError && e.response.status === 401,
  );
  const account = accountSearch(readerSession, (read) => read());
  const query = {
    teamId: null,
    terms,
    page: 0,
    isOrSearch: false,
    includeDeletedChannels: false,
    timeZoneOffsetSeconds: 0,
  };
  const visible = await account.readPostSearchPage(query);
  assert.deepEqual(
    visible.items.map((item) => item.id),
    [first.id],
  );
  assert.equal(visible.isEnd, false);
  const last = await account.readPostSearchPage({ ...query, page: 1 });
  assert.deepEqual(last.items, []);
  assert.equal(last.isEnd, true);
  console.log(
    `Mattermost ${version} post search verified two team scopes, all teams, viewer access and empty PostgreSQL matches.`,
  );
}
