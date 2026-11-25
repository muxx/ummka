import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  Configuration,
  PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkCreatePost(
  base: string,
  posts: PostsApi,
  channelId: string,
  userId: string,
  version: string,
) {
  const message = "Fixture **message**\nВторая строка";
  const pendingPostId = userId + ":" + randomUUID();
  const createPostRequest = { channelId, message, pendingPostId };
  const created = await posts.createPost({ createPostRequest });
  assert.ok(created.id);
  assert.equal(created.message, message);
  assert.equal(created.userId, userId);
  assert.equal(created.channelId, channelId);
  assert.ok(!created.rootId);
  assert.equal(created.pendingPostId, pendingPostId);
  const repeated = await posts.createPost({ createPostRequest });
  assert.equal(repeated.id, created.id);
  const reply = await posts.createPost({
    createPostRequest: {
      channelId,
      rootId: created.id,
      message: "Fixture reply",
      pendingPostId: userId + ":" + randomUUID(),
    },
  });
  assert.ok(reply.id && reply.id !== created.id);
  assert.equal(reply.userId, userId);
  assert.equal(reply.rootId, created.id);
  const thread = await posts.getPostThread({ postId: created.id });
  assert.deepEqual(new Set(thread.order), new Set([created.id, reply.id]));
  const page = await posts.getPostsForChannel({
    channelId,
    perPage: 60,
    page: 0,
  });
  const matches = Object.values(page.posts ?? {}).filter(
    (p) => p.message === message,
  );
  assert.deepEqual(
    matches.map((post) => post.id),
    [created.id],
  );
  await assert.rejects(
    new PostsApi(new Configuration({ basePath: base })).createPost({
      createPostRequest: { channelId, message: "Anonymous fixture" },
    }),
    (err) => err instanceof ResponseError && err.response.status === 401,
  );
  console.log(
    `Mattermost ${version} verified a root, a thread reply and an immediately repeated pending post ID.`,
  );
}
