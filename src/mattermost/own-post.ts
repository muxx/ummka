import type { PostsApi } from "../../vendor/mattermost/index.js";
import { channelPostChange } from "./channel-post-records.ts";
import type { LocalPost } from "./local-history.ts";
import { isMattermostId } from "./model-fields.ts";

export type OwnPostTarget = Pick<
  LocalPost,
  "id" | "userId" | "channelId" | "rootId"
>;

export function assertOwnPostTarget(
  accountId: string,
  { id, userId, channelId, rootId }: OwnPostTarget,
) {
  if (
    !isMattermostId(id) ||
    !isMattermostId(userId) ||
    userId !== accountId ||
    !isMattermostId(channelId) ||
    (rootId !== null && (!isMattermostId(rootId) || rootId === id))
  )
    throw new TypeError("Invalid published post target for this account.");
}

function requirePostConfirmation(
  response: Response,
  action: "edit" | "deletion",
) {
  if (response.status === 200) return;
  // The native transport retains the exchange until its body is read or cancelled.
  void response.body?.cancel().catch(() => {});
  throw new TypeError(`Mattermost did not confirm the post ${action}.`);
}

export async function editOwnPostMessage(
  posts: PostsApi,
  accountId: string,
  target: OwnPostTarget,
  message: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  assertOwnPostTarget(accountId, target);
  if (typeof message !== "string")
    throw new TypeError("Invalid Mattermost post text.");
  const { id, channelId, rootId } = target;
  const response = await posts.patchPostRaw(
    { postId: id, patchPostRequest: { message } },
    { signal },
  );
  requirePostConfirmation(response.raw, "edit");
  const row = channelPostChange(channelId, id, await response.value());
  signal?.throwIfAborted();
  if (row.kind !== "save" || row.userId !== accountId || row.rootId !== rootId)
    throw new TypeError("Mattermost confirmed a different published post.");
  return row;
}

export async function deleteOwnPost(
  posts: PostsApi,
  accountId: string,
  target: OwnPostTarget,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  assertOwnPostTarget(accountId, target);
  const response = await posts.deletePostRaw({ postId: target.id }, { signal });
  requirePostConfirmation(response.raw, "deletion");
  if ((await response.value())?.status !== "OK")
    throw new TypeError("Mattermost did not confirm the post deletion.");
  signal?.throwIfAborted();
}
