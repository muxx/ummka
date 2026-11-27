import type { Post, PostList } from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";
import { receivedPostAttachments } from "./post-attachments.ts";

type AiAttribution =
  | { kind: "none" }
  | { kind: "source"; userId: string; hasUsername: boolean };

type DisplayPriority = "standard" | "important" | "urgent" | "other";

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
  const ordered = new Set(page.order);
  return Object.entries(posts).map(([id, post]) =>
    channelPostChange(channelId, id, post, {
      collapsedThreads,
      priority: ordered.has(id) ? "full" : "partial",
    }),
  );
}

export function channelPostChange(
  channelId: string,
  id: string,
  post: Post,
  {
    collapsedThreads = false,
    priority = "full",
  }: { collapsedThreads?: boolean; priority?: "full" | "partial" } = {},
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
  const displayPriority = readDisplayPriority(
    post.metadata?.priority?.priority,
    priority,
  );
  const aiAttribution = readAiAttribution(post.props);
  return {
    ...(attachments && { attachments }),
    ...(fromWebhook !== undefined && { fromWebhook }),
    ...(displayPriority !== undefined && { displayPriority }),
    ...(aiAttribution && { aiAttribution }),
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

function readDisplayPriority(
  value: unknown,
  coverage: "full" | "partial",
): DisplayPriority | undefined {
  if (value === "" || (value == null && coverage === "full")) return "standard";
  if (value === "important" || value === "urgent") return value;
  if (typeof value === "string") return "other";
  return undefined;
}

function readAiAttribution(props: unknown): AiAttribution | undefined {
  if (props == null) return { kind: "none" };
  if (typeof props !== "object" || Array.isArray(props)) return undefined;
  const id = Object.getOwnPropertyDescriptor(props, "ai_generated_by");
  const name = Object.getOwnPropertyDescriptor(
    props,
    "ai_generated_by_username",
  );
  if (!id && !name) return { kind: "none" };
  if (!isMattermostId(id?.value) || (name && typeof name.value !== "string"))
    return undefined;
  return {
    kind: "source",
    userId: id.value,
    hasUsername: Boolean(name?.value),
  };
}

export type ChannelPostChange = ReturnType<typeof channelPostChange>;

/** Merge typed observations under the same version rules as the native history writer. */
export function mergePostObservation<
  T extends {
    updateAt: number;
    fromWebhook?: boolean;
    displayPriority?: DisplayPriority;
    aiAttribution?: AiAttribution;
  },
>(
  previous: T | null | undefined,
  received: T,
  equal: "keep" | "refresh",
  allowEqualPriority = false,
): T {
  if (!previous) return received;
  if (received.updateAt < previous.updateAt) return previous;
  const newer = received.updateAt > previous.updateAt;
  const row = newer || equal === "refresh" ? received : previous;
  const fromWebhook = newer
    ? (received.fromWebhook ?? previous.fromWebhook)
    : (previous.fromWebhook ?? received.fromWebhook);
  const aiAttribution = newer
    ? (received.aiAttribution ?? previous.aiAttribution)
    : (previous.aiAttribution ?? received.aiAttribution);
  const displayPriority =
    newer || allowEqualPriority
      ? (received.displayPriority ?? previous.displayPriority)
      : (previous.displayPriority ?? received.displayPriority);
  return row.fromWebhook === fromWebhook &&
    row.aiAttribution === aiAttribution &&
    row.displayPriority === displayPriority
    ? row
    : { ...row, fromWebhook, aiAttribution, displayPriority };
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
