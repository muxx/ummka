import type {
  GetPostsForChannelRequest,
  PostList,
} from "../../vendor/mattermost/index.js";
import { channelPostChanges } from "./channel-post-records.ts";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

interface FocusedRead {
  channelId: string;
  collapsedThreads: boolean;
  focusedPostId: string;
}

function channelReadSource(request: GetPostsForChannelRequest | FocusedRead) {
  if ("focusedPostId" in request) {
    if (!isMattermostId(request.focusedPostId))
      throw new TypeError("Invalid focused post ID.");
    return { kind: "focused" as const, postId: request.focusedPostId };
  }
  if (request.includeDeleted)
    throw new TypeError(
      "An administrative deleted-post listing cannot describe the visible timeline.",
    );
  for (const anchor of [request.before, request.after]) {
    if (anchor !== undefined && anchor !== "" && !isMattermostId(anchor))
      throw new TypeError("Invalid channel page anchor.");
  }
  if (request.since !== undefined && !isMattermostTime(request.since, 0))
    throw new RangeError("Invalid channel update time.");
  // Mattermost handles a positive since first, followed by after, before, then page.
  if (request.since) return { kind: "since" as const, since: request.since };
  if ((request.page ?? 0) !== 0)
    throw new RangeError(
      "A page offset cannot establish adjacency to the requested post.",
    );
  if (request.after) return { kind: "after" as const, postId: request.after };
  if (request.before)
    return { kind: "before" as const, postId: request.before };
  return { kind: "latest" as const };
}

/** Capture the order and boundaries with the request that produced them, before merging pages. */
export function channelHistoryPage(
  request: GetPostsForChannelRequest | FocusedRead,
  page: PostList,
) {
  const source = channelReadSource(request);
  const collapsedThreads = request.collapsedThreads ?? false;
  const { order, posts, prevPostId, nextPostId, firstInaccessiblePostTime } =
    page;
  if (
    typeof collapsedThreads !== "boolean" ||
    !posts ||
    !Array.isArray(order) ||
    order.some((id) => typeof id !== "string" || !Object.hasOwn(posts, id))
  ) {
    throw new TypeError("Invalid visible channel post order.");
  }
  for (const cursor of [prevPostId, nextPostId]) {
    if (cursor !== undefined && cursor !== "" && !isMattermostId(cursor))
      throw new TypeError("Invalid channel page boundary.");
  }
  if (
    firstInaccessiblePostTime !== undefined &&
    !isMattermostTime(firstInaccessiblePostTime, 0)
  ) {
    throw new TypeError("Invalid channel history access boundary.");
  }
  if (
    source.kind === "focused" &&
    !order.includes(source.postId) &&
    (order.length > 0 || !firstInaccessiblePostTime)
  ) {
    throw new TypeError(
      "The focused message is missing from its visible page.",
    );
  }
  const changes = channelPostChanges(request.channelId, page, collapsedThreads);
  return {
    channelId: request.channelId,
    collapsedThreads,
    source,
    order: [...order],
    changes,
    prevPostId,
    nextPostId,
    firstInaccessiblePostTime,
  };
}
