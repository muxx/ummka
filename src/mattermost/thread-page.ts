import type { PostsApi } from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

type ThreadPosition = { id: string; createAt: number };
function follows(
  post: ThreadPosition,
  cursor: ThreadPosition,
  direction: "up" | "down",
) {
  if (post.id === cursor.id) return false;
  if (post.createAt === cursor.createAt)
    return direction === "down" ? post.id > cursor.id : post.id < cursor.id;
  return direction === "down"
    ? post.createAt > cursor.createAt
    : post.createAt < cursor.createAt;
}

export interface ThreadPageRequest {
  channelId: string;
  rootId: string;
  collapsedThreads: boolean;
  direction: "up" | "down";
  cursor?: ThreadPosition;
  perPage?: number;
}

export async function readThreadPage(
  api: Pick<PostsApi, "getPostThread">,
  request: ThreadPageRequest,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const {
    channelId,
    rootId,
    collapsedThreads,
    direction,
    perPage = 60,
  } = request;
  const fromPost = request.cursor?.id;
  const fromCreateAt = request.cursor?.createAt;
  if (
    !isMattermostId(channelId) ||
    !isMattermostId(rootId) ||
    typeof collapsedThreads !== "boolean" ||
    (direction !== "up" && direction !== "down") ||
    (request.cursor !== undefined &&
      (!isMattermostId(fromPost) || !isMattermostTime(fromCreateAt, 1)))
  )
    throw new TypeError("Invalid Mattermost thread page request.");
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 200)
    throw new RangeError("Expected a thread page size between 1 and 200.");

  const { order, posts, firstInaccessiblePostTime, hasNext } =
    await api.getPostThread(
      {
        postId: rootId,
        direction,
        perPage,
        collapsedThreads,
        fromPost,
        fromCreateAt,
      },
      { signal },
    );
  signal?.throwIfAborted();
  if (
    firstInaccessiblePostTime !== undefined &&
    !isMattermostTime(firstInaccessiblePostTime, 0)
  )
    throw new TypeError("Invalid Mattermost thread history boundary.");
  if (Array.isArray(order) && order.length === 0 && firstInaccessiblePostTime)
    return { kind: "inaccessible" as const, firstInaccessiblePostTime };
  if (
    !Array.isArray(order) ||
    order[0] !== rootId ||
    order.length > perPage + 1 ||
    !posts ||
    typeof hasNext !== "boolean" ||
    firstInaccessiblePostTime ||
    new Set(order).size !== order.length
  )
    throw new TypeError("Invalid Mattermost thread page.");

  let previous =
    fromPost !== undefined && fromCreateAt !== undefined
      ? { id: fromPost, createAt: fromCreateAt }
      : undefined;
  const rows = order.map((id) => {
    const post = posts[id];
    if (
      !isMattermostId(id) ||
      !Object.hasOwn(posts, id) ||
      post?.id !== id ||
      post.channelId !== channelId ||
      post.rootId !== (id === rootId ? "" : rootId) ||
      post.deleteAt !== 0 ||
      !isMattermostTime(post.createAt, 1)
    )
      throw new TypeError("Invalid visible Mattermost thread post.");
    const row = { ...post, id, createAt: post.createAt };
    if (!collapsedThreads || id !== rootId) delete row.isFollowing;
    if (id !== rootId) {
      if (previous && !follows(row, previous, direction))
        throw new TypeError("Mattermost thread replies did not advance.");
      previous = row;
    }
    return row;
  });
  const [root, ...replies] = rows;
  if (collapsedThreads) {
    if (root.isFollowing !== undefined && typeof root.isFollowing !== "boolean")
      throw new TypeError("Invalid Mattermost thread subscription.");
    // The collapsed query joins membership against the root, even before its first reply.
    root.isFollowing ??= false;
  }
  const edge = rows[rows.length - 1];
  // Flat pagination includes the root in the database's sorted rows, even for imported threads.
  if (
    hasNext &&
    replies.length === 0 &&
    (collapsedThreads ||
      perPage !== 1 ||
      (previous && !follows(root, previous, direction)))
  )
    throw new TypeError("Mattermost thread page did not advance.");
  return {
    kind: "page" as const,
    root,
    replies,
    next: hasNext ? { id: edge.id, createAt: edge.createAt } : null,
  };
}
