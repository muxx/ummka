import type { ThreadsApi } from "../../vendor/mattermost/index.js";

export async function checkThreadList(
  threads: ThreadsApi,
  teamId: string,
  channelId: string,
  userId: string,
) {
  const scope = { userId: "me", teamId };
  const page = await threads.getUserThreads({
    ...scope,
    before: "n".repeat(26),
    perPage: 25,
    extended: true,
    unread: true,
    excludeDirect: false,
  });
  if (
    page.total !== 7 ||
    page.totalUnreadThreads !== 3 ||
    page.totalUnreadMentions !== 5 ||
    page.totalUnreadUrgentMentions !== 2 ||
    page.threads?.length !== 1
  )
    throw Error("Thread list lost aggregate counts or rows");
  const row = page.threads[0],
    id = "p".repeat(26);
  if (
    row.id !== id ||
    row.post?.id !== id ||
    row.post.channelId !== channelId ||
    row.post.message !== "Thread list fixture" ||
    row.participants?.length !== 1 ||
    row.participants[0].id !== userId ||
    row.participants[0].username !== "fixture-participant" ||
    row.replyCount !== 9 ||
    row.lastReplyAt !== 740 ||
    row.lastViewedAt !== 500 ||
    row.deleteAt !== 0 ||
    row.unreadReplies !== 4 ||
    row.unreadMentions !== 2 ||
    row.isUrgent !== true
  )
    throw Error(
      "Thread list lost the root, participant, unread fields or priority",
    );
  const totals = await threads.getUserThreads({
    ...scope,
    totalsOnly: true,
    excludeDirect: true,
  });
  if (
    totals.threads !== null ||
    totals.total !== 7 ||
    totals.totalUnreadThreads !== 3 ||
    totals.totalUnreadMentions !== 5 ||
    totals.totalUnreadUrgentMentions !== 2
  )
    throw Error("Totals-only thread response lost its null page or counts");
  const empty = await threads.getUserThreads({
    ...scope,
    after: id,
    perPage: 25,
    threadsOnly: true,
  });
  if (empty.threads?.length !== 0 || empty.total !== 0)
    throw Error("Expected an empty thread array");
}
