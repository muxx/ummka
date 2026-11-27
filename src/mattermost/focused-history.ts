import type { PostList, PostsApi } from "../../vendor/mattermost/index.js";
import { describeChannelHistoryPage } from "./channel-history-page.ts";
import {
  type ChannelPostChange,
  channelPostChanges,
  mergePostObservation,
} from "./channel-post-records.ts";

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
  channelId: string;
  collapsedThreads: boolean;
  anchorId: string;
  after: PostList;
  thread: PostList;
  before: PostList;
}

/** Build the channel timeline around a post, keeping extra thread replies available by ID. */
export function assembleFocusedHistory({
  channelId,
  collapsedThreads,
  anchorId,
  after,
  thread,
  before,
}: FocusedHistoryParts) {
  const request = { channelId, collapsedThreads, focusedPostId: anchorId };
  const threadBoundary = thread.firstInaccessiblePostTime ?? 0;
  if (!thread.posts || !Object.hasOwn(thread.posts, anchorId)) {
    if (thread.order?.length === 0 && threadBoundary > 0) {
      return describeChannelHistoryPage(
        request,
        {
          order: [],
          nextPostId: "",
          prevPostId: "",
          firstInaccessiblePostTime: threadBoundary,
        },
        [],
      );
    }
    throw new Error("The focused post is missing from its thread.");
  }
  if (!after.order || !after.posts || !before.order || !before.posts) {
    throw new Error("A channel page is missing its order or posts.");
  }
  const changes = new Map<string, ChannelPostChange>();
  for (const page of [after, thread, before]) {
    for (const row of channelPostChanges(channelId, page, collapsedThreads)) {
      const previous = changes.get(row.id);
      if (previous?.kind === "remove") continue;
      // Deletions are unversioned in the writer protocol, so a stale visible
      // copy must not mask a removal from another response.
      changes.set(
        row.id,
        row.kind === "remove"
          ? row
          : mergePostObservation(previous, row, "refresh"),
      );
    }
  }
  return describeChannelHistoryPage(
    request,
    {
      order: [...after.order, anchorId, ...before.order],
      nextPostId: after.nextPostId,
      prevPostId: before.prevPostId,
      firstInaccessiblePostTime: Math.max(
        after.firstInaccessiblePostTime ?? 0,
        threadBoundary,
        before.firstInaccessiblePostTime ?? 0,
      ),
    },
    [...changes.values()],
  );
}
