import assert from "node:assert/strict";
import {
  type Configuration,
  type PostsApi,
  ResponseError,
  ThreadsApi,
  type UserThreads,
} from "../../../vendor/mattermost/index.js";

function rows(page: UserThreads) {
  assert.ok(Array.isArray(page.threads), "Expected an array in a thread page");
  return page.threads;
}

export async function checkThreadList(
  reader: { session: Configuration; username: string },
  writer: { posts: PostsApi; id: string; username: string },
  anonymous: Configuration,
  teamId: string,
  channelId: string,
  directId: string,
  version: string,
) {
  const threads = new ThreadsApi(reader.session);
  const scope = { userId: "me", teamId };
  const page = { ...scope, perPage: 25, threadsOnly: true };
  assert.deepEqual(rows(await threads.getUserThreads(page)), []);

  async function followConversation(channel: string, message: string) {
    const root = await writer.posts.createPost({
      createPostRequest: { channelId: channel, message },
    });
    assert.ok(root.id);
    const threadId = root.id;
    const firstReply = await writer.posts.createPost({
      createPostRequest: {
        channelId: channel,
        rootId: threadId,
        message: "First reply",
      },
    });
    assert.ok(firstReply.createAt);
    assert.equal(
      (await threads.startFollowingThread({ ...scope, threadId })).status,
      "OK",
    );
    return { id: threadId, replyAt: firstReply.createAt };
  }

  const room = await followConversation(channelId, "Followed team discussion");
  const direct = await followConversation(
    directId,
    "Followed private discussion",
  );
  assert.deepEqual(
    rows(await threads.getUserThreads({ ...page, unread: true })),
    [],
  );
  const reply = await writer.posts.createPost({
    createPostRequest: {
      channelId: directId,
      rootId: direct.id,
      message: `@${reader.username} one new reply`,
    },
  });
  assert.ok(
    reply.createAt &&
      reply.createAt > direct.replyAt &&
      direct.replyAt > room.replyAt,
    "The real replies must have distinct server timestamps for cursor assertions",
  );
  const first = await threads.getUserThreads({
    ...page,
    extended: true,
    perPage: 1,
  });
  assert.equal(first.total, 0);
  assert.equal(first.totalUnreadThreads, 0);
  assert.equal(first.totalUnreadMentions, 0);
  assert.equal(first.totalUnreadUrgentMentions, 0);
  const [newest] = rows(first);
  assert.equal(rows(first).length, 1);
  assert.equal(newest?.id, direct.id);
  assert.equal(newest.post?.id, direct.id);
  assert.equal(newest.post.channelId, directId);
  assert.equal(newest.post.message, "Followed private discussion");
  assert.equal(newest.lastReplyAt, reply.createAt);
  assert.equal(newest.replyCount, 2);
  assert.equal(newest.unreadReplies, 1);
  assert.equal(newest.unreadMentions, 1);
  assert.equal(newest.deleteAt, 0);
  assert.equal(newest.isUrgent, false);
  assert.ok(
    typeof newest.lastViewedAt === "number" &&
      newest.lastViewedAt < reply.createAt,
  );
  assert.ok(
    newest.participants?.some(
      (user) => user.id === writer.id && user.username === writer.username,
    ),
  );

  const previous = rows(
    await threads.getUserThreads({ ...page, before: direct.id, perPage: 1 }),
  );
  assert.deepEqual(
    previous.map((row) => row.id),
    [room.id],
  );
  assert.equal(previous[0].lastReplyAt, room.replyAt);
  assert.equal(previous[0].post?.channelId, channelId);
  const participant = previous[0].participants?.find(
    (user) => user.id === writer.id,
  );
  assert.ok(participant && !participant.username);
  assert.deepEqual(
    rows(
      await threads.getUserThreads({ ...page, after: room.id, perPage: 1 }),
    ).map((row) => row.id),
    [direct.id],
  );
  assert.deepEqual(
    rows(await threads.getUserThreads({ ...page, before: room.id })),
    [],
  );
  assert.deepEqual(
    rows(await threads.getUserThreads({ ...page, excludeDirect: true })).map(
      (row) => row.id,
    ),
    [room.id],
  );
  assert.deepEqual(
    rows(await threads.getUserThreads({ ...page, unread: true })).map(
      (row) => row.id,
    ),
    [direct.id],
  );
  assert.deepEqual(
    rows(
      await threads.getUserThreads({
        ...page,
        unread: true,
        excludeDirect: true,
      }),
    ),
    [],
  );
  const counts = await threads.getUserThreads({ ...scope, totalsOnly: true });
  assert.equal(counts.threads, null);
  assert.equal(counts.total, 2);
  assert.equal(counts.totalUnreadThreads, 1);
  assert.equal(counts.totalUnreadMentions, 1);
  assert.equal(counts.totalUnreadUrgentMentions, 0);

  const failedWith = (status: number) => (error: unknown) =>
    error instanceof ResponseError && error.response.status === status;
  await assert.rejects(
    threads.getUserThreads({ ...page, before: direct.id, after: room.id }),
    failedWith(400),
  );
  await assert.rejects(
    threads.getUserThreads({ ...page, totalsOnly: true }),
    failedWith(400),
  );
  await assert.rejects(
    threads.getUserThreads({ ...page, userId: writer.id }),
    failedWith(403),
  );
  await assert.rejects(
    new ThreadsApi(anonymous).getUserThreads(page),
    failedWith(401),
  );
  console.log(
    `Mattermost ${version} verified thread list cursors, participants, unread totals, direct conversations and account isolation.`,
  );
}
