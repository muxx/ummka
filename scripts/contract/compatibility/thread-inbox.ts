import assert from "node:assert/strict";
import { openThreadInbox } from "../../../src/channels/thread-inbox.ts";
import type { accountFollowedThreads } from "../../../src/mattermost/account-followed-threads.ts";

export async function checkOpenThreadInbox(
  reader: ReturnType<typeof accountFollowedThreads>,
  teamId: string,
  subjectId: string,
  mention: () => Promise<unknown>,
  other: { id: string; mention: () => Promise<unknown> },
) {
  const inbox = openThreadInbox(reader, teamId);
  try {
    await inbox.show("followed");
    const first = inbox.getSnapshot();
    assert.ok(first.page.rows?.some((row) => row.id === subjectId));
    assert.equal(first.totals.value?.totalUnreadThreads, 1);
    await inbox.show("unread");
    const row = inbox
      .getSnapshot()
      .page.rows?.find((item) => item.id === subjectId);
    assert.ok(row && row.unreadReplies > 0);
    inbox.select(subjectId);
    const mark = await reader.markFollowedThreadRead(
      teamId,
      subjectId,
      row.lastReplyAt,
    );
    await inbox.confirmRead(mark);
    assert.equal(inbox.getSnapshot().totals.value?.totalUnreadThreads, 0);
    assert.equal(
      inbox.getSnapshot().page.rows?.find((item) => item.id === subjectId)
        ?.unreadReplies,
      0,
    );
    await inbox.show("followed");
    await other.mention();
    await inbox.refreshTotals();
    assert.equal(inbox.getSnapshot().totals.value?.totalUnreadThreads, 1);
    await inbox.show("unread");
    assert.deepEqual(
      inbox.getSnapshot().page.rows?.map((row) => row.id),
      [subjectId, other.id],
    );
    inbox.select(null);
    assert.deepEqual(
      inbox.getSnapshot().page.rows?.map((row) => row.id),
      [other.id],
    );
    await reader.markTeamThreadsRead(teamId);
    await mention();
    await inbox.reload();
    assert.equal(inbox.getSnapshot().totals.value?.totalUnreadThreads, 1);
    assert.deepEqual(
      inbox.getSnapshot().page.rows?.map((row) => row.id),
      [subjectId],
    );
  } finally {
    inbox.close();
  }
}
