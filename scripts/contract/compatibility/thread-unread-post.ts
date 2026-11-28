import assert from "node:assert/strict";
import { accountFollowedThreads } from "../../../src/mattermost/account-followed-threads.ts";
import {
  ChannelsApi,
  type Configuration,
  PostsApi,
  ThreadsApi,
  type UserThread,
} from "../../../vendor/mattermost/index.js";

function receipt(row: UserThread | undefined, threadId: string) {
  assert.ok(row);
  assert.equal(row.id, threadId);
  assert.equal(row.post?.id, threadId);
  return [row.lastViewedAt, row.unreadReplies, row.unreadMentions];
}

export async function checkThreadUnreadPost(
  readerSession: Configuration,
  readerName: string,
  writerSession: Configuration,
  teamId: string,
  channelIds: string[],
  version: string,
  ties: {
    teamId: string;
    seed: (
      message: string,
      rootId: string | undefined,
      createAt: number,
    ) => Promise<{ id: string; create_at: number }>;
  },
) {
  const reader = new ThreadsApi(readerSession);
  const account = accountFollowedThreads(readerSession, (read) => read());
  const channels = new ChannelsApi(readerSession);
  const writer = new ThreadsApi(writerSession);
  const posts = new PostsApi(writerSession);
  const list = async (threads: ThreadsApi, team: string, id: string) => {
    const page = await threads.getUserThreads({
      userId: "me",
      teamId: team,
      perPage: 200,
      threadsOnly: true,
    });
    return page.threads?.find((row) => row.id === id);
  };
  const mark = async (
    scope: { userId: string; teamId: string; threadId: string },
    postId: string,
    expected: number[],
  ) => {
    const [lastViewedAt, unreadReplies, unreadMentions] = expected;
    assert.deepEqual(
      await account.markThreadUnreadFromPost(scope.teamId, {
        id: postId,
        rootId: postId === scope.threadId ? null : scope.threadId,
      }),
      { id: scope.threadId, lastViewedAt, unreadReplies, unreadMentions },
    );
    assert.deepEqual(
      receipt(await list(reader, scope.teamId, scope.threadId), scope.threadId),
      expected,
    );
  };
  for (const channelId of channelIds) {
    const root = await posts.createPost({
      createPostRequest: { channelId, message: "Unread-from-post fixture" },
    });
    assert.ok(root.id && root.createAt);
    const scope = { userId: "me", teamId, threadId: root.id };
    const reply = () =>
      posts.createPost({
        createPostRequest: {
          channelId,
          rootId: scope.threadId,
          message: `@${readerName} reply`,
        },
      });
    const first = await reply();
    assert.ok(first.createAt);
    await reader.startFollowingThread(scope);
    await writer.startFollowingThread(scope);
    const last = await reply();
    assert.ok(last.id && last.createAt);
    await reader.updateThreadReadForUser({
      ...scope,
      timestamp: last.createAt + 1,
    });
    assert.deepEqual(receipt(await list(reader, teamId, root.id), root.id), [
      last.createAt + 1,
      0,
      0,
    ]);
    const writerBefore = receipt(await list(writer, teamId, root.id), root.id);
    const channelScope = { channelId, userId: "me" };
    const channelBefore = await channels.getChannelMember(channelScope);
    assert.ok(Number.isSafeInteger(channelBefore.lastViewedAt));

    const boundary = last.createAt - 1;
    const fromLast = [
      boundary,
      first.createAt > boundary ? 2 : 1,
      first.createAt >= boundary ? 2 : 1,
    ];
    await mark(scope, last.id, fromLast);
    await mark(scope, last.id, fromLast);
    await mark(scope, root.id, [root.createAt - 1, 2, 2]);
    assert.equal((await reader.stopFollowingThread(scope)).status, "OK");
    assert.equal(await list(reader, teamId, root.id), undefined);
    await mark(scope, last.id, fromLast);
    assert.deepEqual(
      receipt(await list(writer, teamId, root.id), root.id),
      writerBefore,
    );
    const channelAfter = await channels.getChannelMember(channelScope);
    assert.equal(channelAfter.lastViewedAt, channelBefore.lastViewedAt);
  }
  console.log(
    `Mattermost ${version} verified the signed account marking unread from a reply and its root, repeated marks, automatic follow, independent peer and channel positions and team-scoped DM.`,
  );
  // The fixture importer fixes three timestamps. The reader still uses its
  // ordinary authenticated session for marking and verifying read state.
  const at = Date.now();
  const root = await ties.seed("Unread twin timestamps", undefined, at - 2);
  const first = await ties.seed(
    `@${readerName} earlier reply`,
    root.id,
    at - 1,
  );
  const late = await ties.seed(`@${readerName} first tied reply`, root.id, at);
  const twin = await ties.seed(`@${readerName} second tied reply`, root.id, at);
  assert.deepEqual(
    [first.create_at, late.create_at, twin.create_at],
    [at - 1, at, at],
  );
  const scope = { userId: "me", teamId: ties.teamId, threadId: root.id };
  for (const reply of [late, twin]) {
    await mark(scope, reply.id, [at - 1, 2, 3]);
  }
  console.log(
    `Mattermost ${version} confirmed both tied replies give the same boundary, two unread replies and three mentions.`,
  );
}
