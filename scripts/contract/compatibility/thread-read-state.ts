import assert from "node:assert/strict";
import {
  type Configuration,
  PostsApi,
  ThreadsApi,
  type UserThread,
} from "../../../vendor/mattermost/index.js";

function account(session: Configuration, username: string) {
  return {
    posts: new PostsApi(session),
    threads: new ThreadsApi(session),
    username,
  };
}

async function conversation(
  author: ReturnType<typeof account>,
  follower: ReturnType<typeof account>,
  teamId: string,
  channelId: string,
) {
  const root = await author.posts.createPost({
    createPostRequest: { channelId, message: "Read-state fixture" },
  });
  assert.ok(root.id);
  const threadId = root.id;
  const reply = (message: string) =>
    author.posts.createPost({
      createPostRequest: { channelId, rootId: threadId, message },
    });
  await reply("First reply establishes the discussion");
  const scope = { userId: "me", teamId, threadId };
  assert.equal(
    (await follower.threads.startFollowingThread(scope)).status,
    "OK",
  );
  const mention = () => reply(`@${follower.username} thread read check`);
  const latest = await mention();
  assert.ok(latest.createAt);
  return { scope, timestamp: latest.createAt, mention };
}

function counts(row: UserThread | undefined) {
  assert.ok(row);
  return [row.unreadReplies, row.unreadMentions];
}

export async function checkThreadReadState(
  readerSession: Configuration,
  readerName: string,
  writerSession: Configuration,
  writerName: string,
  room: { teamId: string; channelId: string; directId: string },
  other: { teamId: string; channelId: string },
  version: string,
) {
  const reader = account(readerSession, readerName);
  const writer = account(writerSession, writerName);
  const subject = await conversation(
    writer,
    reader,
    room.teamId,
    room.channelId,
  );
  const latest = await subject.mention();
  assert.ok(latest.createAt && latest.createAt > subject.timestamp);
  const direct = await conversation(writer, reader, room.teamId, room.directId);
  const outside = await conversation(
    writer,
    reader,
    other.teamId,
    other.channelId,
  );
  const personal = await conversation(
    reader,
    writer,
    room.teamId,
    room.channelId,
  );
  const scope = { userId: "me", teamId: room.teamId };
  const page = (
    person: ReturnType<typeof account>,
    teamId: string,
    excludeDirect = false,
  ) =>
    person.threads.getUserThreads({
      userId: "me",
      teamId,
      perPage: 200,
      excludeDirect,
    });
  const totals = () =>
    reader.threads.getUserThreads({ ...scope, totalsOnly: true });
  const writerSnapshot = await page(writer, room.teamId);
  assert.deepEqual(
    counts(
      writerSnapshot.threads?.find((row) => row.id === personal.scope.threadId),
    ),
    [1, 1],
  );
  const otherSnapshot = await page(reader, other.teamId, true);
  assert.deepEqual(
    counts(
      otherSnapshot.threads?.find((row) => row.id === outside.scope.threadId),
    ),
    [1, 1],
  );
  const before = await totals();
  assert.ok(
    typeof before.totalUnreadThreads === "number" &&
      before.totalUnreadThreads >= 2,
  );
  assert.ok(
    typeof before.totalUnreadMentions === "number" &&
      before.totalUnreadMentions >= 3,
  );
  const initial = await page(reader, room.teamId);
  assert.deepEqual(
    counts(initial.threads?.find((row) => row.id === subject.scope.threadId)),
    [2, 2],
  );
  assert.deepEqual(
    counts(initial.threads?.find((row) => row.id === direct.scope.threadId)),
    [1, 1],
  );

  // Replies count CreateAt > timestamp, mentions count CreateAt >= timestamp.
  for (const [timestamp, replies, mentions] of [
    [subject.timestamp, 1, 2],
    [latest.createAt, 0, 1],
    [latest.createAt + 1, 0, 0],
  ]) {
    const result = await reader.threads.updateThreadReadForUser({
      ...subject.scope,
      timestamp,
    });
    assert.equal(result.id, subject.scope.threadId);
    assert.equal(result.post?.id, subject.scope.threadId);
    assert.equal(result.lastViewedAt, timestamp);
    assert.deepEqual(counts(result), [replies, mentions]);
    const after = await totals();
    assert.equal(after.total, before.total);
    assert.equal(
      after.totalUnreadThreads,
      before.totalUnreadThreads - (replies === 0 ? 1 : 0),
    );
    assert.equal(
      after.totalUnreadMentions,
      before.totalUnreadMentions - (2 - mentions),
    );
    assert.equal(
      after.totalUnreadUrgentMentions,
      before.totalUnreadUrgentMentions,
    );
  }
  const intermediate = await page(reader, room.teamId);
  assert.deepEqual(
    counts(
      intermediate.threads?.find((row) => row.id === direct.scope.threadId),
    ),
    [1, 1],
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(await reader.threads.updateThreadsReadForUser(scope), {
      status: "OK",
    });
    const after = await totals();
    assert.equal(after.total, before.total);
    assert.equal(after.totalUnreadThreads, 0);
    assert.equal(after.totalUnreadMentions, 0);
    assert.equal(after.totalUnreadUrgentMentions, 0);
    const read = await page(reader, room.teamId);
    assert.deepEqual(
      counts(read.threads?.find((row) => row.id === direct.scope.threadId)),
      [0, 0],
    );
  }
  assert.deepEqual(await page(writer, room.teamId), writerSnapshot);
  assert.deepEqual(await page(reader, other.teamId, true), otherSnapshot);
  console.log(
    `Mattermost ${version} verified partial, complete and team-wide thread read state, direct conversations and isolation across users and teams.`,
  );
}
