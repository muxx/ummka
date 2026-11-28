import assert from "node:assert/strict";
import { accountFollowedThreads } from "../../../src/mattermost/account-followed-threads.ts";
import type { Configuration, Post } from "../../../vendor/mattermost/index.js";
import { checkOpenThreadInbox } from "./thread-inbox.ts";

type Conversation = {
  scope: { threadId: string };
  mention: () => Promise<Post>;
};

export async function checkAccountThreadReadState(
  readerSession: Configuration,
  writerSession: Configuration,
  teamId: string,
  otherTeamId: string,
  subject: Conversation,
  direct: Conversation,
  outsideId: string,
  writerThreadId: string,
) {
  const reader = accountFollowedThreads(readerSession, (read) => read());
  const writer = accountFollowedThreads(writerSession, (read) => read());
  const totals = () => reader.readFollowedThreadTotals(teamId);
  const counts = async (account: typeof reader, scope: string, id: string) => {
    const page = await account.readFollowedThreads({
      teamId: scope,
      unread: false,
      perPage: 200,
    });
    const row = page.items.find((item) => item.id === id);
    assert.ok(row);
    return [row.unreadReplies, row.unreadMentions];
  };
  const before = await totals();
  assert.equal(before.totalUnreadThreads, 0);
  assert.deepEqual(await counts(writer, teamId, writerThreadId), [1, 1]);
  assert.deepEqual(await counts(reader, otherTeamId, outsideId), [1, 1]);
  const first = await subject.mention();
  const latest = await subject.mention();
  assert.ok(
    first.createAt && latest.createAt && first.createAt < latest.createAt,
  );
  await direct.mention();
  const state = await reader.markFollowedThreadRead(
    teamId,
    subject.scope.threadId,
    first.createAt,
  );
  assert.deepEqual(state, {
    id: subject.scope.threadId,
    lastViewedAt: first.createAt,
    unreadReplies: 1,
    unreadMentions: 2,
  });
  assert.deepEqual(await totals(), {
    ...before,
    totalUnreadThreads: 2,
    totalUnreadMentions: 3,
  });
  await reader.markFollowedThreadRead(
    teamId,
    subject.scope.threadId,
    latest.createAt + 1,
  );
  assert.deepEqual(await totals(), {
    ...before,
    totalUnreadThreads: 1,
    totalUnreadMentions: 1,
  });
  await reader.markTeamThreadsRead(teamId);
  assert.deepEqual(await counts(reader, teamId, direct.scope.threadId), [0, 0]);
  // This reply races the consumer's next read of the confirmed team totals.
  await subject.mention();
  assert.deepEqual(await totals(), {
    ...before,
    totalUnreadThreads: 1,
    totalUnreadMentions: 1,
  });
  assert.deepEqual(await counts(writer, teamId, writerThreadId), [1, 1]);
  assert.deepEqual(await counts(reader, otherTeamId, outsideId), [1, 1]);
  await checkOpenThreadInbox(
    reader,
    teamId,
    subject.scope.threadId,
    subject.mention,
    { id: direct.scope.threadId, mention: direct.mention },
  );
}
