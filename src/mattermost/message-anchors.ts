import type { FilesApi, PostsApi } from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";

export async function readPostAnchor(
  posts: Pick<PostsApi, "getPost">,
  postId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(postId))
    throw new TypeError("Invalid Mattermost post ID.");
  const post = await posts.getPost({ postId }, { signal });
  signal?.throwIfAborted();
  if (
    post?.id !== postId ||
    !isMattermostId(post.channelId) ||
    (post.rootId !== "" && !isMattermostId(post.rootId)) ||
    post.rootId === postId
  )
    throw new TypeError("Invalid Mattermost post anchor.");
  return { postId, channelId: post.channelId, rootId: post.rootId || null };
}

export async function readFileAnchor(
  files: Pick<FilesApi, "getFileInfo">,
  fileId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(fileId))
    throw new TypeError("Invalid Mattermost file ID.");
  const file = await files.getFileInfo({ fileId }, { signal });
  signal?.throwIfAborted();
  if (
    file?.id !== fileId ||
    !isMattermostId(file.channelId) ||
    (file.postId !== undefined &&
      file.postId !== "" &&
      !isMattermostId(file.postId))
  )
    throw new TypeError("Invalid Mattermost file anchor.");
  return { fileId, channelId: file.channelId, postId: file.postId || null };
}
