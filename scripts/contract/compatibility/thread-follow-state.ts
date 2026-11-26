import assert from "node:assert/strict";
import { readThreadPage } from "../../../src/mattermost/thread-page.ts";
import {
  type PostsApi,
  ResponseError,
  type ThreadsApi,
} from "../../../vendor/mattermost/index.js";

export async function checkThreadFollowState(
  threads: ThreadsApi,
  reader: PostsApi,
  author: PostsApi,
  teamId: string,
  channelIds: string[],
  privatePostId: string,
  version: string,
) {
  for (const [index, channelId] of channelIds.entries()) {
    const root = await author.createPost({
      createPostRequest: { channelId, message: "Subscription before replies" },
    });
    assert.ok(root.id);
    const query = { userId: "me", teamId, threadId: root.id };
    async function read(
      posts: PostsApi,
      rootId: string,
      collapsedThreads = true,
    ) {
      const page = await readThreadPage(posts, {
        channelId,
        rootId,
        collapsedThreads,
        direction: "down",
        perPage: 1,
      });
      assert.equal(page.kind, "page");
      assert.equal(page.root.id, rootId);
      return page.root.isFollowing;
    }

    assert.equal(await read(reader, root.id), false);
    const authorState = await read(author, root.id);
    for (const following of [true, false]) {
      if (following) await threads.startFollowingThread(query);
      else await threads.stopFollowingThread(query);
      assert.equal(await read(reader, root.id), following);
      assert.equal(await read(reader, root.id, false), undefined);
      assert.equal(await read(author, root.id), authorState);
    }

    const discussion = await author.createPost({
      createPostRequest: { channelId, message: "First reply subscription" },
    });
    assert.ok(discussion.id);
    assert.equal(await read(reader, discussion.id), false);
    const firstReply = await author.createPost({
      createPostRequest: {
        channelId,
        rootId: discussion.id,
        message: "A new reply",
      },
    });
    assert.equal(await read(reader, discussion.id), index === 1);
    const flat = await readThreadPage(reader, {
      channelId,
      rootId: discussion.id,
      collapsedThreads: false,
      direction: "down",
      perPage: 10,
    });
    assert.equal(flat.kind, "page");
    assert.equal(Object.hasOwn(flat.root, "isFollowing"), false);
    assert.deepEqual(
      flat.replies.map((post) => post.id),
      [firstReply.id],
    );
    assert.equal(Object.hasOwn(flat.replies[0], "isFollowing"), false);
    await assert.rejects(
      read(reader, privatePostId),
      (error) =>
        error instanceof ResponseError && error.response.status === 403,
    );
  }
  console.log(
    `Mattermost ${version} verified root subscription before the first reply, flat and collapsed pages, automatic DM follow and a private channel denial.`,
  );
}
