import assert from "node:assert/strict";
import { openPostCollection } from "../../../src/channels/post-collection.ts";
import { accountPostCollections } from "../../../src/mattermost/account-post-collections.ts";
import { accountCollectionActions } from "../../../src/mattermost/post-collection-actions.ts";
import { createSavedPostState } from "../../../src/mattermost/saved-post-state.ts";
import {
  ChannelsApi,
  type Configuration,
  PostsApi,
  PreferencesApi,
  ResponseError,
  UsersApi,
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
  for (const [session, id] of [
    [reader, readerId],
    [observer, observerId],
  ] as const) {
    const user = await new UsersApi(session).getUser({ userId: "me" });
    assert.equal(user.id, id);
    assert.equal(user.roles, "system_user");
  }
  assert.notEqual(readerId, observerId);
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
  const readerSavedState = createSavedPostState();
  const observerSavedState = createSavedPostState();
  const actions = accountCollectionActions(
    reader,
    readerId,
    (change) => change(),
    readerSavedState,
  );
  await actions.setPostSaved(postId, true);
  assert.deepEqual(await saved(posts), [postId]);
  assert.deepEqual(await saved(observerPosts), []);
  await actions.setPostPinned(postId, false);
  assert.deepEqual(await pinned(), []);
  assert.deepEqual(await saved(posts), [postId]);
  await actions.setPostSaved(postId, false);
  assert.deepEqual(await saved(posts), []);
  await actions.setPostPinned(postId, true);
  assert.deepEqual(await pinned(), [postId]);
  await assert.rejects(actions.setPostPinned(privatePostId, true), denied);
  const readerLists = {
    ...accountPostCollections(
      reader,
      readerId,
      (read) => read(),
      readerSavedState,
    ),
    ...actions,
  };
  const observerLists = {
    ...accountPostCollections(
      observer,
      observerId,
      (read) => read(),
      observerSavedState,
    ),
    ...accountCollectionActions(
      observer,
      observerId,
      (write) => write(),
      observerSavedState,
    ),
  };
  const readerPins = openPostCollection(readerLists, {
    kind: "pins",
    channelId: direct,
  });
  const observerPins = openPostCollection(observerLists, {
    kind: "pins",
    channelId: direct,
  });
  const readerSaved = openPostCollection(readerLists, {
    kind: "channel",
    channelId: direct,
  });
  const observerSaved = openPostCollection(observerLists, {
    kind: "channel",
    channelId: direct,
  });
  const lists = [readerPins, observerPins, readerSaved, observerSaved];
  const ids = (view: typeof readerPins) => {
    const state = view.getSnapshot();
    assert.equal(state.status, "ready");
    assert.ok(state.value);
    return state.value.items.map((post) => post.id);
  };
  await actions.setPostSaved(postId, true);
  await Promise.all(lists.map((view) => view.refresh()));
  assert.deepEqual(lists.map(ids), [[postId], [postId], [postId], []]);
  assert.equal(await readerPins.remove(postId), "removed");
  assert.deepEqual(ids(readerPins), []);
  await observerPins.refresh();
  assert.deepEqual(lists.map(ids), [[], [], [postId], []]);
  await observerLists.setPostSaved(postId, true);
  await observerSaved.refresh();
  assert.equal(await readerSaved.remove(postId), "removed");
  assert.deepEqual(ids(readerSaved), []);
  await Promise.all([readerSaved.refresh(), observerSaved.refresh()]);
  assert.deepEqual(lists.map(ids), [[], [], [], [postId]]);
  assert.equal(await observerSaved.remove(postId), "removed");
  for (const view of lists) view.close();
  await actions.setPostPinned(postId, true);
  console.log(
    `Mattermost ${version} verified channel pins and personal saved preferences change independently.`,
  );
}
