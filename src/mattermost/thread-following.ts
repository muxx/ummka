import type { ThreadsApi } from "../../vendor/mattermost/index.js";
import type { LocalPost } from "./local-history.ts";
import { isMattermostId } from "./model-fields.ts";

export type ThreadPost = Pick<LocalPost, "id" | "rootId">;

export async function setThreadFollowing(
  threads: Pick<
    ThreadsApi,
    "startFollowingThreadRaw" | "stopFollowingThreadRaw"
  >,
  teamId: string,
  post: ThreadPost,
  following: boolean,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (
    !isMattermostId(teamId) ||
    !isMattermostId(post?.id) ||
    (post.rootId !== null && !isMattermostId(post.rootId)) ||
    post.rootId === post.id ||
    typeof following !== "boolean"
  )
    throw new TypeError("Invalid Mattermost thread subscription.");
  const request = { userId: "me", teamId, threadId: post.rootId ?? post.id };
  const response = following
    ? await threads.startFollowingThreadRaw(request, { signal })
    : await threads.stopFollowingThreadRaw(request, { signal });
  if (response.raw.status !== 200 || (await response.value())?.status !== "OK")
    throw new TypeError("Mattermost did not confirm the thread subscription.");
}
