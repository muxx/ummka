import type { PostList, PostsApi } from "../../vendor/mattermost/index.js";

interface FocusedNeighborsRequest {
  channelId: string;
  anchorId: string;
  collapsedThreads: boolean;
  perPage?: number;
  skipFetchThreads?: boolean;
  collapsedThreadsExtended?: boolean;
}

/** Read the two sides with the caller's account client; the focus thread is already available. */
export async function readFocusedNeighbors(
  api: PostsApi,
  {
    channelId,
    anchorId,
    collapsedThreads,
    perPage = 30,
    skipFetchThreads = false,
    collapsedThreadsExtended = false,
  }: FocusedNeighborsRequest,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!channelId.trim() || !anchorId.trim()) {
    throw new TypeError("Focused history requires a channel ID and a post ID.");
  }
  if (!Number.isSafeInteger(perPage) || perPage < 1) {
    throw new RangeError(
      "The number of history neighbors must be a positive integer.",
    );
  }
  const page = {
    channelId,
    page: 0,
    perPage,
    skipFetchThreads,
    collapsedThreads,
    collapsedThreadsExtended,
  };
  const [after, before] = await Promise.all([
    api.getPostsForChannel({ ...page, after: anchorId }, { signal }),
    api.getPostsForChannel({ ...page, before: anchorId }, { signal }),
  ]);
  return { after, before };
}

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
