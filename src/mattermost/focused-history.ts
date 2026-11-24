import type { PostList } from "../../vendor/mattermost/index.js";

interface FocusedHistoryParts {
  anchorId: string;
  after: PostList;
  thread: PostList;
  before: PostList;
}

/** Build the channel timeline around a post, keeping extra thread replies available by ID. */
export function assembleFocusedHistory({
  anchorId,
  after,
  thread,
  before,
}: FocusedHistoryParts): PostList {
  const threadBoundary = thread.firstInaccessiblePostTime ?? 0;
  if (!thread.posts || !Object.hasOwn(thread.posts, anchorId)) {
    if (thread.order?.length === 0 && threadBoundary > 0) {
      return {
        order: [],
        posts: {},
        nextPostId: "",
        prevPostId: "",
        firstInaccessiblePostTime: threadBoundary,
      };
    }
    throw new Error("The focused post is missing from its thread.");
  }
  if (!after.order || !after.posts || !before.order || !before.posts) {
    throw new Error("A channel page is missing its order or posts.");
  }
  return {
    order: [...after.order, anchorId, ...before.order],
    posts: { ...after.posts, ...thread.posts, ...before.posts },
    nextPostId: after.nextPostId,
    prevPostId: before.prevPostId,
    firstInaccessiblePostTime: Math.max(
      after.firstInaccessiblePostTime ?? 0,
      threadBoundary,
      before.firstInaccessiblePostTime ?? 0,
    ),
  };
}
