import assert from "node:assert/strict";
import {
  ChannelsApi,
  type Configuration,
  PostsApi,
  PreferencesApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkCollectionActions(
  reader: Configuration,
  observer: Configuration,
  readerId: string,
  observerId: string,
  direct: string,
  postId: string,
  privatePostId: string,
  version: string,
) {
  const posts = new PostsApi(reader);
  const preferences = new PreferencesApi(reader);
  const row = {
    userId: readerId,
    category: "flagged_post",
    name: postId,
    value: "true",
  };
  const own = { userId: "me", preference: [row] };
  const foreign = {
    userId: observerId,
    preference: [{ ...row, userId: observerId }],
  };
  const denied = (error: unknown) =>
    error instanceof ResponseError && error.response.status === 403;
  const pins = new ChannelsApi(observer);
  const observerPosts = new PostsApi(observer);
  const pinned = async () =>
    (await pins.getPinnedPosts({ channelId: direct })).order;
  const saved = async (client: PostsApi) =>
    (await client.getFlaggedPostsForUser({ userId: "me", channelId: direct }))
      .order;
  assert.deepEqual(await pinned(), [postId]);
  assert.deepEqual(await saved(posts), []);
  assert.deepEqual(await preferences.updatePreferences(own), { status: "OK" });
  assert.deepEqual(await saved(posts), [postId]);
  assert.deepEqual(await saved(observerPosts), []);
  assert.deepEqual(await pinned(), [postId]);
  assert.deepEqual(await posts.unpinPost({ postId }), { status: "OK" });
  assert.deepEqual(await pinned(), []);
  assert.deepEqual(await saved(posts), [postId]);
  assert.deepEqual(await posts.pinPost({ postId }), { status: "OK" });
  assert.deepEqual(await preferences.deletePreferences(own), { status: "OK" });
  assert.deepEqual(await saved(posts), []);
  assert.deepEqual(await pinned(), [postId]);
  await assert.rejects(posts.pinPost({ postId: privatePostId }), denied);
  await assert.rejects(posts.unpinPost({ postId: privatePostId }), denied);
  await assert.rejects(preferences.updatePreferences(foreign), denied);
  await assert.rejects(preferences.deletePreferences(foreign), denied);
  assert.deepEqual(await saved(observerPosts), []);
  console.log(
    `Mattermost ${version} verified channel pins and personal saved preferences change independently.`,
  );
}
