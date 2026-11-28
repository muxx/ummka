import { openThreadInbox } from "../../src/channels/thread-inbox.ts";
import type { accountFollowedThreads } from "../../src/mattermost/account-followed-threads.ts";

export async function checkThreadInbox(
  account: ReturnType<typeof accountFollowedThreads>,
  teamId: string,
  rootId: string,
  timestamp: number,
) {
  const inbox = openThreadInbox(account, teamId);
  try {
    await inbox.show("followed");
    const first = inbox.getSnapshot();
    if (
      first.page.rows?.[0]?.id !== rootId ||
      first.page.nextBefore !== null ||
      first.totals.value?.totalUnreadThreads !== 3
    )
      throw Error(
        "Missing signed followed thread or independent team counters.",
      );
    await inbox.show("unread");
    if (inbox.getSnapshot().page.rows?.[0]?.unreadReplies !== 4)
      throw Error("Unread tab lost the signed server page.");
    const mark = await account.markFollowedThreadRead(
      teamId,
      rootId,
      timestamp,
    );
    await inbox.confirmRead(mark);
    // The server has new replies beyond the list's earlier lastReplyAt.
    const updated = inbox.getSnapshot().page.rows?.[0];
    if (
      updated?.lastViewedAt !== timestamp ||
      updated.unreadReplies !== 3 ||
      updated.unreadMentions !== 2
    )
      throw Error("Newer unread replies disappeared from the open inbox.");
    await inbox.show("followed");
    if (inbox.getSnapshot().page.rows?.[0]?.unreadReplies !== 3)
      throw Error("Followed tab lost the confirmed read state.");
  } finally {
    inbox.close();
  }
}
