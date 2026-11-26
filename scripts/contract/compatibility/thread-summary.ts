import assert from "node:assert/strict";
import { channelHistoryPage } from "../../../src/mattermost/channel-history-page.ts";
import type { PostsApi } from "../../../vendor/mattermost/index.js";

export async function checkThreadSummary(
  author: PostsApi,
  other: PostsApi,
  channelId: string,
) {
  const create = (api: PostsApi, message: string, rootId?: string) =>
    api.createPost({ createPostRequest: { channelId, rootId, message } });
  const root = await create(author, "Thread summary check");
  assert.ok(root.id);
  const rootId = root.id;
  async function observe(collapsedThreads: boolean) {
    const query = { channelId, page: 0, perPage: 60, collapsedThreads };
    const page = channelHistoryPage(
      query,
      await other.getPostsForChannel(query),
    );
    const record = page.changes.find((row) => row.id === rootId);
    assert.ok(record?.kind === "save");
    return record.threadSummary;
  }
  assert.deepEqual(await observe(true), {
    replyCount: 0,
    lastReplyAt: 0,
    participantIds: null,
  });
  const first = await create(author, "First reply", rootId);
  const second = await create(other, "Second reply", rootId);
  assert.ok(
    first.id &&
      second.id &&
      first.userId &&
      second.userId &&
      first.userId !== second.userId,
  );
  assert.equal(await observe(false), undefined);
  assert.deepEqual(await observe(true), {
    replyCount: 2,
    lastReplyAt: second.createAt,
    participantIds: [first.userId, second.userId],
  });
  await other.deletePost({ postId: second.id });
  assert.deepEqual(await observe(true), {
    replyCount: 1,
    lastReplyAt: first.createAt,
    participantIds: [first.userId],
  });
  await author.deletePost({ postId: first.id });
  assert.deepEqual(await observe(true), {
    replyCount: 0,
    lastReplyAt: 0,
    participantIds: null,
  });
  console.log(
    "Verified collapsed thread summaries and both reply deletions through channel history.",
  );
}
