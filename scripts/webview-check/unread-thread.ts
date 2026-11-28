import { openThreadReplyWindow } from "../../src/channels/thread-reply-window.ts";
import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";
import type { ThreadPageRequest } from "../../src/mattermost/thread-page.ts";
export async function checkUnreadThread(
  account: Awaited<ReturnType<typeof openAccountRestConnection>>,
  userId: string,
) {
  const rootId = "k".repeat(26),
    channelId = "w".repeat(26),
    foreign = "z".repeat(26);
  const window = openThreadReplyWindow(
    {
      readThreadPage: (query: ThreadPageRequest, signal?: AbortSignal) =>
        account.readThreadPage({ ...query, perPage: 1 }, signal),
    },
    { channelId, rootId, collapsedThreads: true },
    { userId, lastViewedAt: 300 },
  );
  try {
    await window.open();
    if (
      window.getSnapshot().root?.id !== rootId ||
      window.getSnapshot().replies.length !== 2 ||
      window.getUnreadPosition()?.kind !== "pending"
    )
      throw Error("Signed thread window lost a tied read or an own reply.");
    await window.more("down");
    const mark = window.getUnreadPosition();
    if (
      mark?.kind !== "found" ||
      mark.postId !== foreign ||
      window.getSnapshot().down.status !== "end"
    )
      throw Error(
        "Signed thread window lost the first foreign reply beyond its cursor.",
      );
    const stored = await account.readSavedPost(channelId, foreign);
    const previous = await account.readSavedPost(channelId, "l".repeat(26));
    if (
      stored?.cards?.[0]?.title !== "Thread-only release" ||
      previous?.cards?.[0]?.title !== "Release reply"
    )
      throw Error(
        "Thread paging lost a card from the current or previous page",
      );
  } finally {
    window.close();
  }
}
