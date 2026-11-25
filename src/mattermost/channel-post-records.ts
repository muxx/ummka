import type { Post, PostList } from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

/** Project the complete REST dictionary into the native history store's text records. */
export function channelPostChanges(channelId: string, page: PostList) {
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
    channelPostChange(channelId, id, post),
  );
}

export function channelPostChange(channelId: string, id: string, post: Post) {
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
}
