import type { PostsApi } from "../../vendor/mattermost/index.js";
import type { LocalPost } from "./local-history.ts";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

export type EditHistoryTarget = Pick<
  LocalPost,
  "id" | "userId" | "channelId" | "rootId"
>;

export async function readPostEditHistory(
  posts: PostsApi,
  accountId: string,
  { id, userId, channelId, rootId }: EditHistoryTarget,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (
    !isMattermostId(id) ||
    !isMattermostId(channelId) ||
    !isMattermostId(userId) ||
    userId !== accountId ||
    (rootId !== null && (!isMattermostId(rootId) || rootId === id))
  )
    throw new TypeError("Invalid edit history target for this account.");

  const rows = await posts.getEditHistoryForPost({ postId: id }, { signal });
  signal?.throwIfAborted();
  const seen = new Set([id]);
  return rows.map((row) => {
    if (
      !isMattermostId(row?.id) ||
      seen.has(row.id) ||
      row.originalId !== id ||
      row.channelId !== channelId ||
      row.userId !== userId ||
      row.rootId !== (rootId ?? "") ||
      !isMattermostTime(row.createAt, 1) ||
      !isMattermostTime(row.editAt, 0) ||
      !isMattermostTime(row.deleteAt, 1) ||
      typeof row.message !== "string" ||
      (row.fileIds !== undefined &&
        (!Array.isArray(row.fileIds) || !row.fileIds.every(isMattermostId)))
    )
      throw new TypeError("Invalid Mattermost edit history revision.");
    seen.add(row.id);
    return {
      id: row.id,
      message: row.message,
      timestamp: row.editAt || row.createAt,
      fileIds: row.fileIds ?? [],
    };
  });
}
