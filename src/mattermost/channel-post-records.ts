import type { Post, PostList } from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";
import { receivedPostAttachments } from "./post-attachments.ts";

/** Project the complete REST dictionary into the native history store's text records. */
export function channelPostChanges(
  channelId: string,
  page: PostList,
  collapsedThreads = false,
) {
  const posts = page.posts;
  if (
    !isMattermostId(channelId) ||
    !posts ||
    typeof posts !== "object" ||
    Array.isArray(posts)
  ) {
    throw new TypeError("Invalid Mattermost channel post dictionary.");
  }
  return Object.entries(posts).map(([id, post]) =>
    channelPostChange(channelId, id, post, collapsedThreads),
  );
}

export function channelPostChange(
  channelId: string,
  id: string,
  post: Post,
  collapsedThreads = false,
) {
  if (
    !isMattermostId(id) ||
    post?.id !== id ||
    post.channelId !== channelId ||
    !isMattermostTime(post.deleteAt, 0)
  ) {
    throw new TypeError("Invalid Mattermost post identity or deletion time.");
  }
  if (post.deleteAt > 0) return { kind: "remove" as const, id, channelId };

  const {
    userId,
    rootId,
    createAt,
    updateAt,
    editAt,
    type,
    message,
    messageSource,
    hashtags,
    isPinned,
  } = post;
  if (
    !isMattermostId(userId) ||
    (rootId !== "" && !isMattermostId(rootId)) ||
    rootId === id ||
    !isMattermostTime(createAt, 1) ||
    !isMattermostTime(updateAt, 1) ||
    !isMattermostTime(editAt, 0) ||
    typeof type !== "string" ||
    typeof message !== "string" ||
    (messageSource !== undefined && typeof messageSource !== "string") ||
    typeof hashtags !== "string" ||
    typeof isPinned !== "boolean"
  ) {
    throw new TypeError("Invalid Mattermost channel post fields.");
  }
  const summary =
    collapsedThreads && rootId === "" ? threadSummary(post) : undefined;
  const attachments = receivedPostAttachments(post);
  const fromWebhook = webhookOrigin(post.props);
  return {
    ...(attachments && { attachments }),
    ...(fromWebhook !== undefined && { fromWebhook }),
    ...(summary && { threadSummary: summary }),
    kind: "save" as const,
    id,
    channelId,
    userId,
    rootId: rootId || null,
    createAt,
    updateAt,
    editAt,
    type,
    message,
    messageSource: messageSource ?? null,
    hashtags,
    isPinned,
  };
}

// Incoming webhooks use the string "true". Use the observation for display.
// The servers can warn about malformed values without removing them.
function webhookOrigin(props: unknown): boolean | undefined {
  if (props == null) return false;
  if (typeof props !== "object" || Array.isArray(props)) return undefined;
  const marker = Object.getOwnPropertyDescriptor(props, "from_webhook")?.value;
  if (marker === "true") return true;
  return marker == null ? false : undefined;
}

export type ChannelPostChange = ReturnType<typeof channelPostChange>;

/** Merge the flag under the same version rules as the native history writer. */
export function mergePostObservation<
  T extends { updateAt: number; fromWebhook?: boolean },
>(previous: T | null | undefined, received: T, equal: "keep" | "refresh"): T {
  if (!previous) return received;
  if (received.updateAt < previous.updateAt) return previous;
  const newer = received.updateAt > previous.updateAt;
  const row = newer || equal === "refresh" ? received : previous;
  const fromWebhook = newer
    ? (received.fromWebhook ?? previous.fromWebhook)
    : (previous.fromWebhook ?? received.fromWebhook);
  return row.fromWebhook === fromWebhook ? row : { ...row, fromWebhook };
}

// Flat pages can report zero for a root with replies. Only a collapsed read calls this.
function threadSummary({ replyCount, lastReplyAt, participants }: Post) {
  if (replyCount === undefined || lastReplyAt === undefined) return undefined;
  if (!isMattermostTime(replyCount, 0) || !isMattermostTime(lastReplyAt, 0))
    throw new TypeError("Invalid Mattermost thread summary.");

  const participantIds =
    participants?.map((participant) => {
      if (!isMattermostId(participant?.id))
        throw new TypeError("Invalid Mattermost thread participant ID.");
      return participant.id;
    }) ?? null;
  return { replyCount, lastReplyAt, participantIds };
}
