import assert from "node:assert/strict";
import { openPostCollection } from "../../../src/channels/post-collection.ts";
import { accountPostCollections } from "../../../src/mattermost/account-post-collections.ts";
import { accountCollectionActions } from "../../../src/mattermost/post-collection-actions.ts";
import { createSavedPostState } from "../../../src/mattermost/saved-post-state.ts";
import {
  ChannelsApi,
  Configuration,
  PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

async function flagPosts(
  base: string,
  reader: { token: string; id: string },
  ids: string[],
) {
  const result = await fetch(`${base}/api/v4/users/me/preferences`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${reader.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      ids.map((id) => ({
        user_id: reader.id,
        category: "flagged_post",
        name: id,
        value: "true",
      })),
    ),
  });
  assert.equal(result.status, 200);
}

export async function checkPostCollections(
  owner: { session: Configuration; id: string },
  reader: { id: string; token: string },
  secondReader: { session: Configuration; id: string },
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
  await flagPosts(owner.session.basePath, reader, [pins.older, pins.newer]);
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
  const other = new PostsApi(secondReader.session);
  assert.deepEqual(
    (await other.getFlaggedPostsForUser({ userId: "me" })).order,
    [],
  );
  await assert.rejects(
    other.getFlaggedPostsForUser({ userId: reader.id }),
    denied,
  );
  const readerAccount = accountPostCollections(config, reader.id, (read) =>
    read(),
  );
  const otherAccount = accountPostCollections(
    secondReader.session,
    secondReader.id,
    (read) => read(),
  );
  const channelPins = await readerAccount.readPinnedChannelPosts(scope.channel);
  assert.deepEqual(
    channelPins.items.map((post) => post.id),
    pinned.order,
  );
  assert.equal(channelPins.firstInaccessiblePostTime, 0);
  await assert.rejects(
    readerAccount.readPinnedChannelPosts(scope.privateChannel),
    denied,
  );
  for (const filter of [
    { kind: "all" },
    { kind: "team", teamId: scope.team },
    { kind: "channel", channelId: scope.channel },
  ] as const) {
    const savedPage = await readerAccount.readSavedPosts(filter, 0);
    assert.deepEqual(
      savedPage.items.map((post) => post.id),
      all.order,
    );
    assert.equal(savedPage.firstInaccessiblePostTime, 0);
  }
  for (const page of [
    await readerAccount.readSavedPosts({ kind: "all" }, 1),
    await readerAccount.readSavedPosts(
      { kind: "team", teamId: scope.otherTeam },
      0,
    ),
    await otherAccount.readSavedPosts({ kind: "all" }, 0),
  ])
    assert.deepEqual(page.items, []);
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

export async function checkSavedPageBoundary(
  base: string,
  reader: { token: string; id: string },
  direct: string,
  version: string,
) {
  const config = new Configuration({
    basePath: base,
    accessToken: reader.token,
  });
  const posts = new PostsApi(config);
  const ids: string[] = [];
  for (let i = 0; i < 61; i++) {
    const post = await posts.createPost({
      createPostRequest: {
        channelId: direct,
        message: `Saved boundary fixture ${i}`,
      },
    });
    assert.ok(post.id);
    ids.push(post.id);
  }
  await flagPosts(base, reader, ids);
  const savedState = createSavedPostState();
  const account = accountPostCollections(
    config,
    reader.id,
    (read) => read(),
    savedState,
  );
  const scope = { kind: "channel" as const, channelId: direct };
  const first = await account.readSavedPosts(scope, 0);
  const second = await account.readSavedPosts(scope, 1);
  const empty = await account.readSavedPosts(scope, 2);
  assert.equal(first.items.length, 60);
  assert.equal(second.items.length, 1);
  assert.deepEqual(empty.items, []);
  assert.deepEqual(
    new Set([...first.items, ...second.items].map((post) => post.id)),
    new Set(ids),
  );
  const view = openPostCollection(
    {
      ...account,
      ...accountCollectionActions(
        config,
        reader.id,
        (write) => write(),
        savedState,
      ),
    },
    scope,
  );
  await view.refresh();
  const removed = first.items[0].id;
  assert.equal(await view.remove(removed), "removed");
  await view.loadMore();
  assert.deepEqual(
    new Set(view.getSnapshot().value?.items.map((row) => row.id)),
    new Set(ids.filter((id) => id !== removed)),
  );
  assert.equal(view.getSnapshot().value?.items.length, 60);
  view.close();
  console.log(
    `Mattermost ${version} preserved all 60 remaining saved posts when the first page shrank before continuing.`,
  );
  console.log(
    `Mattermost ${version} returned 61 distinct saved posts in two pages of 60 and one.`,
  );
}
