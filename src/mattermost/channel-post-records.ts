import type { PostList } from "../../vendor/mattermost/index.js";

const idPattern = /^[A-Za-z0-9]{26}$/u;

function isId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length === 26 && idPattern.test(value)
  );
}

function isTime(value: unknown, minimum: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

/** Project the complete REST dictionary into the native history store's text records. */
export function channelPostChanges(channelId: string, page: PostList) {
  const posts = page.posts;
  if (
    !isId(channelId) ||
    !posts ||
    typeof posts !== "object" ||
    Array.isArray(posts)
  ) {
    throw new TypeError("Invalid Mattermost channel post dictionary.");
  }
  return Object.entries(posts).map(([id, post]) => {
    if (
      !isId(id) ||
      post?.id !== id ||
      post.channelId !== channelId ||
      !isTime(post.deleteAt, 0)
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
      !isId(userId) ||
      (rootId !== "" && !isId(rootId)) ||
      rootId === id ||
      !isTime(createAt, 1) ||
      !isTime(updateAt, 1) ||
      !isTime(editAt, 0) ||
      typeof type !== "string" ||
      typeof message !== "string" ||
      (messageSource !== undefined && typeof messageSource !== "string") ||
      typeof hashtags !== "string" ||
      typeof isPinned !== "boolean"
    ) {
      throw new TypeError("Invalid Mattermost channel post fields.");
    }
    return {
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
  });
}
