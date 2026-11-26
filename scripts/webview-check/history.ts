import { publishedPostDocument } from "../../src/channels/published-post-document.ts";
import { publishedPostExcerpt } from "../../src/channels/published-post-excerpt.ts";
import { readFocusedNeighbors } from "../../src/mattermost/focused-history.ts";
import {
  type Configuration,
  PostsApi,
  ResponseError,
} from "../../vendor/mattermost/index.js";

export async function checkChannelHistory(
  root: Configuration,
  prefixed: Configuration,
  anonymous: Configuration,
) {
  const channelId = "c".repeat(26);
  const rootId = "r".repeat(26);
  const replyId = "p".repeat(26);
  const page = await new PostsApi(root).getPostsForChannel({
    channelId,
    page: 0,
    perPage: 2,
  });
  const thread = page.posts?.[rootId];
  const image =
    thread?.metadata?.images?.["https://image.example.test/post.png"];
  if (
    page.order?.join(",") !== `${replyId},${rootId}` ||
    page.posts?.[replyId]?.rootId !== rootId ||
    thread?.channelId !== channelId ||
    thread.participants !== null ||
    image?.width !== 4 ||
    image.height !== 3 ||
    image.format !== "png" ||
    image.frameCount !== 0 ||
    page.prevPostId !== rootId ||
    page.nextPostId !== "" ||
    page.hasNext !== false ||
    page.firstInaccessiblePostTime !== 0
  )
    throw Error("generated channel history");
  if (
    typeof thread.message !== "string" ||
    publishedPostExcerpt(publishedPostDocument({ message: thread.message })) !==
      "Release notes Chart :wave:"
  )
    throw Error(
      "Signed channel history did not yield the expected post excerpt",
    );

  const collapsed = await new PostsApi(prefixed).getPostsForChannel({
    channelId,
    before: replyId,
    perPage: 2,
    skipFetchThreads: false,
    collapsedThreads: true,
    collapsedThreadsExtended: true,
  });
  const summary = collapsed.posts?.[rootId];
  if (
    collapsed.order?.length !== 1 ||
    collapsed.order[0] !== rootId ||
    collapsed.firstInaccessiblePostTime !== 1800 ||
    summary?.replyCount !== 1 ||
    summary.lastReplyAt !== 2200 ||
    summary.isFollowing !== false ||
    summary.participants?.[0]?.username !== "fixture"
  )
    throw Error("generated collapsed channel history");

  const neighbors = await readFocusedNeighbors(new PostsApi(prefixed), {
    channelId,
    anchorId: rootId,
    perPage: 1,
    collapsedThreads: true,
  });
  if (
    neighbors.after.order?.join(",") !== "n".repeat(26) ||
    neighbors.before.order?.join(",") !== "o".repeat(26)
  )
    throw Error("Account history lost the neighbors around its focus");

  try {
    await new PostsApi(anonymous).getPostsForChannelRaw({ channelId });
  } catch (error) {
    if (
      error instanceof ResponseError &&
      error.response.status === 401 &&
      (await error.response.json()).message === "session required"
    )
      return;
    throw error;
  }
  throw Error("anonymous channel history unexpectedly succeeded");
}
