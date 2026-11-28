import type {
  FileInfo,
  FilesApi,
  PostsApi,
} from "../../vendor/mattermost/index.js";
import { channelPostChange } from "./channel-post-records.ts";
import { isMattermostId } from "./model-fields.ts";
import { receivedFileDetails } from "./received-file.ts";

export class PostObservationSuperseded extends Error {
  constructor() {
    super("Post observation superseded by a local history change.");
  }
}

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
  return fileAddress(file, fileId);
}
function fileAddress(file: FileInfo, fileId: string) {
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

export async function readChannelFile(
  files: Pick<FilesApi, "getFileInfoRaw">,
  channelId: string,
  fileId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(channelId) || !isMattermostId(fileId))
    throw TypeError("Invalid Mattermost channel file address.");
  const reply = await files.getFileInfoRaw({ fileId }, { signal });
  if (reply.raw.status !== 200) {
    await reply.raw.body?.cancel();
    throw TypeError("Incomplete Mattermost file response.");
  }
  const info = await reply.value();
  signal?.throwIfAborted();
  const address = fileAddress(info, fileId);
  if (address.channelId !== channelId)
    throw TypeError("Mattermost returned a file from another channel.");
  return { file: receivedFileDetails(info), postId: address.postId };
}
