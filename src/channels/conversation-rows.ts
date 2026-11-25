import type { PendingPost } from "../mattermost/account-delivery.ts";
import type { LocalChannelWindow } from "../mattermost/local-history.ts";

type Saved = LocalChannelWindow["posts"][number];
export type TimelineMessage = { localId?: string } & (
  | (Saved & { outgoing?: never })
  | (Pick<
      Saved,
      "id" | "userId" | "createAt" | "editAt" | "message" | "isPinned"
    > & {
      outgoing: PendingPost;
    })
);

/** Both inputs are newest first. The server owns tie order and SQLite owns the order of local attempts. */
export function conversationRows(
  history: readonly Saved[],
  pending: readonly PendingPost[],
  channelId: string,
  rootId: string | null,
  userId: string,
  latest: boolean,
) {
  const confirmed = new Map<string, PendingPost>();
  const scoped = pending.filter(
    (post) => post.channelId === channelId && post.rootId === rootId,
  );
  for (const post of scoped)
    if (post.confirmedPostId) confirmed.set(post.confirmedPostId, post);

  const matched = new Set<string>();
  const saved: TimelineMessage[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const post = history[i];
    const local = confirmed.get(post.id);
    if (
      local &&
      post.userId === userId &&
      post.channelId === channelId &&
      post.rootId === rootId
    ) {
      matched.add(post.id);
      saved.push({ ...post, localId: local.pendingId });
    } else saved.push(post);
  }
  const messages: TimelineMessage[] = [];
  let index = 0;
  if (latest) {
    for (let i = scoped.length - 1; i >= 0; i--) {
      const post = scoped[i];
      if (post.confirmedPostId && matched.has(post.confirmedPostId)) continue;
      while (index < saved.length && saved[index].createAt <= post.createdAt)
        messages.push(saved[index++]);
      messages.push({
        id: post.pendingId,
        createAt: post.createdAt,
        editAt: 0,
        isPinned: false,
        message: post.message,
        userId,
        outgoing: post,
      });
    }
  }
  while (index < saved.length) messages.push(saved[index++]);
  return { messages, matched: [...matched] };
}
