import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  Configuration,
  PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkPostMutations(
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
  const props = { fixture_flag: true, fixture_label: "kept on edit" };
  const tagged = await posts.patchPost({
    postId: reply.id,
    patchPostRequest: { props },
  });
  assert.equal(tagged.id, reply.id);
  assert.deepEqual(tagged.props, props);
  const edited = "Updated **reply** · правка";
  const updated = await posts.patchPost({
    postId: reply.id,
    patchPostRequest: { message: edited },
  });
  assert.equal(updated.id, reply.id);
  assert.equal(updated.rootId, created.id);
  assert.equal(updated.message, edited);
  assert.deepEqual(updated.props, props);
  const thread = await posts.getPostThread({ postId: created.id });
  assert.deepEqual(new Set(thread.order), new Set([created.id, reply.id]));
  assert.equal(thread.posts?.[reply.id]?.message, edited);
  assert.deepEqual(thread.posts?.[reply.id]?.props, props);
  const deleted = await posts.deletePost({ postId: reply.id });
  assert.equal(deleted.status, "OK");
  const remaining = await posts.getPostThread({ postId: created.id });
  assert.deepEqual(remaining.order, [created.id]);
  assert.ok(!remaining.posts?.[reply.id]);
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
    `Mattermost ${version} verified a root, reply, repeated pending ID, independent edits and confirmed deletion.`,
  );
}
