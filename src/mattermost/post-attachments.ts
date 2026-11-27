import type {
  FileInfo,
  Post,
  PostsApi,
} from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";
import { type ReceivedFile, receivedFileDetails } from "./received-file.ts";

interface ReceivedAttachments {
  fileIds?: string[];
  files?: ReceivedFile[];
  redactedFileCount?: number;
}

function invalid(): never {
  throw new TypeError("Invalid Mattermost post attachment data.");
}

function nonnegativeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Keep the two server orders independent, including explicitly empty lists. */
export function receivedPostAttachments(
  post: Post,
): ReceivedAttachments | undefined {
  const { fileIds, metadata } = post;
  const files = metadata?.files;
  const redactedFileCount = metadata?.redactedFileCount;
  if (
    fileIds === undefined &&
    files === undefined &&
    redactedFileCount === undefined
  )
    return undefined;

  const result: ReceivedAttachments = {};
  if (redactedFileCount !== undefined) {
    if (
      !nonnegativeInteger(redactedFileCount) ||
      (redactedFileCount > 0 && (fileIds?.length || files?.length))
    )
      invalid();
    result.redactedFileCount = redactedFileCount;
  }
  if (fileIds !== undefined) {
    if (
      !Array.isArray(fileIds) ||
      !fileIds.every(isMattermostId) ||
      new Set(fileIds).size !== fileIds.length
    )
      invalid();
    result.fileIds = [...fileIds];
  }
  if (files !== undefined) result.files = receivedFiles(post, files);
  return result;
}

function receivedFiles(
  post: Pick<Post, "id" | "channelId">,
  files: FileInfo[],
) {
  if (!Array.isArray(files)) invalid();
  const seen = new Set<string>();
  return files.map((file) => {
    const detail = receivedFileDetails(file);
    if (
      (file.postId !== undefined &&
        file.postId !== "" &&
        file.postId !== post.id) ||
      (file.channelId !== undefined &&
        file.channelId !== "" &&
        file.channelId !== post.channelId)
    )
      invalid();
    if (seen.has(detail.id)) invalid();
    seen.add(detail.id);
    return detail;
  });
}

export async function readPostFiles(
  posts: Pick<PostsApi, "getFileInfosForPostRaw">,
  channelId: string,
  postId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(channelId) || !isMattermostId(postId))
    throw new TypeError("Invalid Mattermost post attachment address.");
  const response = await posts.getFileInfosForPostRaw({ postId }, { signal });
  if (response.raw.status !== 200) {
    await response.raw.body?.cancel();
    throw new TypeError("Incomplete Mattermost post attachment response.");
  }
  const files = await response.value();
  signal?.throwIfAborted();
  // Mattermost 12.1 may return JSON null for a post without files.
  return files === null ? [] : receivedFiles({ id: postId, channelId }, files);
}
