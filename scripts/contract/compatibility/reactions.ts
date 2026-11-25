import assert from "node:assert/strict";
import {
  type Configuration,
  PostsApi,
  ReactionsApi,
  ReactionToJSON,
} from "../../../vendor/mattermost/index.js";

export async function checkReactionReads(
  base: string,
  token: string,
  session: Configuration,
  userId: string,
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
  const created = await fetch(`${base}/api/v4/reactions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      user_id: userId,
      post_id: postId,
      emoji_name: "+1",
    }),
  });
  assert.equal(created.status, 200);
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
  assert.deepEqual(await created.json(), row);
  const list = await reader.getReactions({ postId });
  assert.deepEqual(list?.map(ReactionToJSON), raw);
  assert.deepEqual(
    (await posts.getPostThread({ postId })).posts?.[
      postId
    ]?.metadata?.reactions?.map(ReactionToJSON),
    raw,
  );
  const removed = await fetch(
    `${base}/api/v4/users/${userId}/posts/${postId}/reactions/%2B1`,
    { method: "DELETE", headers },
  );
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).status, "OK");
  assert.equal(await reader.getReactions({ postId }), null);
}
