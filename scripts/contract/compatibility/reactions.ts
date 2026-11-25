import assert from "node:assert/strict";
import { accountPostReactions } from "../../../src/mattermost/account-post-reactions.ts";
import {
  Configuration,
  PostsApi,
  ReactionsApi,
  ReactionToJSON,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkPostReactions(
  base: string,
  token: string,
  session: Configuration,
  userId: string,
  otherUserId: string,
  channelId: string,
) {
  const posts = new PostsApi(session);
  const reader = new ReactionsApi(session);
  const post = await posts.createPost({
    createPostRequest: { channelId, message: "Reaction fixture" },
  });
  assert.ok(post.id);
  const postId = post.id;
  const url = `${base}/api/v4/posts/${postId}/reactions`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal(await reader.getReactions({ postId }), null);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const save = { saveReactionRequest: { userId, postId, emojiName: "+1" } };
  const remove = { userId: "me", postId, emojiName: "+1" };
  const anonymous = new ReactionsApi(new Configuration({ basePath: base }));
  await assert.rejects(
    anonymous.saveReaction(save),
    (error: unknown) =>
      error instanceof ResponseError && error.response.status === 401,
  );
  await assert.rejects(
    anonymous.deleteReaction(remove),
    (error: unknown) =>
      error instanceof ResponseError && error.response.status === 401,
  );
  await assert.rejects(
    reader.saveReaction({
      saveReactionRequest: { ...save.saveReactionRequest, userId: otherUserId },
    }),
    (error: unknown) =>
      error instanceof ResponseError && error.response.status === 403,
  );
  assert.equal(await reader.getReactions({ postId }), null);
  const created = await reader.saveReactionRaw(save);
  assert.equal(created.raw.status, 200);
  const rawResponse = await fetch(url, { headers });
  assert.equal(rawResponse.status, 200);
  const raw = await rawResponse.json();
  assert.equal(raw.length, 1);
  const [row] = raw;
  assert.equal(row.user_id, userId);
  assert.equal(row.post_id, postId);
  assert.equal(row.channel_id, channelId);
  assert.equal(row.emoji_name, "+1");
  assert.ok(row.create_at > 0 && row.update_at >= row.create_at);
  assert.equal(row.delete_at, 0);
  assert.equal(row.remote_id, "");
  assert.deepEqual(ReactionToJSON(await created.value()), row);
  const list = await reader.getReactions({ postId });
  assert.deepEqual(list?.map(ReactionToJSON), raw);
  assert.deepEqual(
    (await posts.getPostThread({ postId })).posts?.[
      postId
    ]?.metadata?.reactions?.map(ReactionToJSON),
    raw,
  );
  await reader.saveReaction(save);
  assert.equal((await reader.getReactions({ postId }))?.length, 1);
  for (let attempt = 0; attempt < 2; attempt++) {
    const removed = await reader.deleteReactionRaw(remove);
    assert.equal(removed.raw.status, 200);
    assert.equal((await removed.value()).status, "OK");
    assert.equal(await reader.getReactions({ postId }), null);
  }

  const account = accountPostReactions(session, userId, (operation) =>
    operation(),
  );
  assert.deepEqual(await account.readPostReactions(postId), []);
  const own = await account.addOwnReaction(postId, "+1");
  assert.equal(own.channelId, channelId);
  // Re-adding the same emoji keeps the original creation time in the stored list.
  assert.deepEqual(await account.readPostReactions(postId), [
    { ...own, createAt: row.create_at },
  ]);
  await account.removeOwnReaction(postId, "+1");
  await account.removeOwnReaction(postId, "+1");
  assert.deepEqual(await account.readPostReactions(postId), []);
}
