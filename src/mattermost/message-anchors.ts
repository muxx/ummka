import type { FilesApi, PostsApi } from "../../vendor/mattermost/index.js";
import { channelPostChange } from "./channel-post-records.ts";
import { isMattermostId } from "./model-fields.ts";

export async function readPostAnchor(
  posts: Pick<PostsApi, "getPost">,
  postId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(postId))
    throw new TypeError("Invalid Mattermost post ID.");
  const response = await posts.getPost({ postId }, { signal });
  signal?.throwIfAborted();
  if (!isMattermostId(response?.channelId))
    throw new TypeError("Invalid Mattermost post anchor.");
  const change = channelPostChange(response.channelId, postId, response);
  if (change.kind === "remove")
    return { postId, channelId: change.channelId, post: null };
  const { kind: _kind, ...post } = change;
  return { postId, channelId: post.channelId, rootId: post.rootId, post };
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
