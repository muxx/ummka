import assert from "node:assert/strict";
import {
  ChannelsApi,
  Configuration,
  PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkPostCollections(
  owner: { session: Configuration; id: string },
  reader: { id: string; token: string },
  secondReader: Configuration,
  scope: {
    channel: string;
    privateChannel: string;
    direct: string;
    team: string;
    otherTeam: string;
  },
  pins: { older: string; newer: string; direct: string },
  version: string,
) {
  const config = new Configuration({
    basePath: owner.session.basePath,
    accessToken: reader.token,
  });
  const channels = new ChannelsApi(config);
  const posts = new PostsApi(config);
  const pinned = await channels.getPinnedPosts({ channelId: scope.channel });
  assert.deepEqual(pinned.order, [pins.older, pins.newer]);
  assert.ok(pinned.posts);
  for (const id of pinned.order) {
    assert.equal(pinned.posts[id]?.id, id);
    assert.equal(pinned.posts[id]?.isPinned, true);
  }
  const denied = (e: unknown) =>
    e instanceof ResponseError && e.response.status === 403;
  await assert.rejects(
    channels.getPinnedPosts({ channelId: scope.privateChannel }),
    denied,
  );
  assert.deepEqual(
    (await channels.getPinnedPosts({ channelId: scope.direct })).order,
    [pins.direct],
  );
  assert.deepEqual(
    (
      await new ChannelsApi(owner.session).getPinnedPosts({
        channelId: scope.privateChannel,
      })
    ).order,
    [],
  );

  const saved = (
    filters: {
      teamId?: string;
      channelId?: string;
      page?: number;
      perPage?: number;
    } = {},
  ) => posts.getFlaggedPostsForUser({ userId: "me", ...filters });
  assert.deepEqual((await saved()).order, []);
  const setFlags = await fetch(
    `${owner.session.basePath}/api/v4/users/me/preferences`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${reader.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        [pins.older, pins.newer].map((id) => ({
          user_id: reader.id,
          category: "flagged_post",
          name: id,
          value: "true",
        })),
      ),
    },
  );
  assert.equal(setFlags.status, 200);
  const all = await saved();
  assert.deepEqual(all.order, [pins.newer, pins.older]);
  assert.ok(all.posts);
  for (const id of all.order)
    assert.equal(all.posts[id]?.channelId, scope.channel);
  assert.deepEqual((await saved({ teamId: scope.team })).order, all.order);
  assert.deepEqual((await saved({ teamId: scope.otherTeam })).order, []);
  assert.deepEqual((await saved({ channelId: scope.direct })).order, []);
  assert.deepEqual(
    (await saved({ teamId: scope.otherTeam, channelId: scope.channel })).order,
    all.order,
  );
  assert.deepEqual((await saved({ perPage: 2, page: 1 })).order, [pins.older]);
  const end = await saved({ perPage: 1, page: 2 });
  assert.deepEqual(end.order, []);
  assert.deepEqual(end.posts, {});
  assert.deepEqual(
    (await new PostsApi(owner.session).getFlaggedPostsForUser({ userId: "me" }))
      .order,
    [],
  );
  await assert.rejects(
    posts.getFlaggedPostsForUser({ userId: owner.id }),
    denied,
  );
  const other = new PostsApi(secondReader);
  assert.deepEqual(
    (await other.getFlaggedPostsForUser({ userId: "me" })).order,
    [],
  );
  await assert.rejects(
    other.getFlaggedPostsForUser({ userId: reader.id }),
    denied,
  );
  const anonymous = new PostsApi(
    new Configuration({ basePath: owner.session.basePath }),
  );
  await assert.rejects(
    anonymous.getFlaggedPostsForUser({ userId: reader.id }),
    (e: unknown) => e instanceof ResponseError && e.response.status === 401,
  );
  console.log(
    `Mattermost ${version} verified saved and pinned PostLists, account and channel access, scopes, page order and an empty page.`,
  );
}
