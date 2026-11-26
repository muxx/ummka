import assert from "node:assert/strict";
import { channelPostChange } from "../../../src/mattermost/channel-post-records.ts";
import { setThreadFollowing } from "../../../src/mattermost/thread-following.ts";
import {
  type Configuration,
  PostsApi,
  ResponseError,
  ThreadsApi,
} from "../../../vendor/mattermost/index.js";

import { checkThreadFollowState } from "./thread-follow-state.ts";

export async function checkThreadFollow(
  reader: Configuration,
  anonymous: Configuration,
  author: { posts: PostsApi; userId: string },
  teamId: string,
  channelIds: string[],
  privatePostId: string,
  version: string,
) {
  const threads = new ThreadsApi(reader);
  const guest = new ThreadsApi(anonymous);
  const readerPosts = new PostsApi(reader);
  const failedWith = (status: number) => (error: unknown) =>
    error instanceof ResponseError && error.response.status === status;

  await checkThreadFollowState(
    threads,
    readerPosts,
    author.posts,
    teamId,
    channelIds,
    privatePostId,
    version,
  );
  for (const channelId of channelIds) {
    const root = await author.posts.createPost({
      createPostRequest: { channelId, message: "Thread subscription" },
    });
    assert.ok(root.id);
    const threadId = root.id;
    const reply = await author.posts.createPost({
      createPostRequest: {
        channelId,
        rootId: threadId,
        message: "First reply",
      },
    });
    async function readFollowing(posts: PostsApi) {
      const page = await posts.getPostsForChannel({
        channelId,
        perPage: 60,
        page: 0,
        collapsedThreads: true,
      });
      const post = page.posts?.[threadId];
      assert.equal(post?.id, threadId);
      return post.isFollowing;
    }
    const query = { userId: "me", teamId, threadId };
    const authorState = await readFollowing(author.posts);
    for (const follow of [true, true, false, false]) {
      const response = follow
        ? await threads.startFollowingThreadRaw(query)
        : await threads.stopFollowingThreadRaw(query);
      assert.equal(response.raw.status, 200);
      assert.deepEqual(await response.value(), { status: "OK" });
      assert.equal(await readFollowing(readerPosts), follow);
      assert.equal(await readFollowing(author.posts), authorState);
    }
    assert.ok(reply.id && reply.rootId === threadId);
    const rootRow = channelPostChange(channelId, threadId, root);
    const replyRow = channelPostChange(channelId, reply.id, reply);
    assert.ok(rootRow.kind === "save" && replyRow.kind === "save");
    assert.equal(rootRow.rootId, null);
    for (const [row, following] of [
      [replyRow, true],
      [rootRow, true],
      [rootRow, false],
      [replyRow, false],
    ] as const) {
      await setThreadFollowing(threads, teamId, row, following);
      assert.equal(await readFollowing(readerPosts), following);
      assert.equal(await readFollowing(author.posts), authorState);
    }
    await assert.rejects(
      setThreadFollowing(
        threads,
        teamId,
        { id: privatePostId, rootId: null },
        true,
      ),
      failedWith(403),
    );
    for (const forbidden of [
      { ...query, userId: author.userId },
      { ...query, threadId: privatePostId },
      { ...query, threadId: "z".repeat(26) },
    ]) {
      await assert.rejects(
        threads.startFollowingThread(forbidden),
        failedWith(403),
      );
      await assert.rejects(
        threads.stopFollowingThread(forbidden),
        failedWith(403),
      );
    }
    await assert.rejects(guest.startFollowingThread(query), failedWith(401));
    await assert.rejects(guest.stopFollowingThread(query), failedWith(401));
  }
  console.log(
    `Mattermost ${version} verified personal thread subscriptions in a team channel and DM, repeated writes and access denials.`,
  );
}
