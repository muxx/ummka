import type {
  FileInfo,
  Post,
  PostsApi,
} from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";

interface ReceivedFile {
  id: string;
  name?: string;
  extension?: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  hasPreviewImage?: boolean;
  archived?: boolean;
}

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

function fileDetails(
  file: FileInfo,
  post: Pick<Post, "id" | "channelId">,
): ReceivedFile {
  if (
    !isMattermostId(file?.id) ||
    (file.postId !== undefined &&
      file.postId !== "" &&
      file.postId !== post.id) ||
    (file.channelId !== undefined &&
      file.channelId !== "" &&
      file.channelId !== post.channelId)
  )
    invalid();
  const result: ReceivedFile = { id: file.id };
  for (const field of ["name", "extension", "mimeType"] as const) {
    const value = file[field];
    if (value === undefined) continue;
    if (typeof value !== "string") invalid();
    result[field] = value;
  }
  for (const field of ["size", "width", "height"] as const) {
    const value = file[field];
    if (value === undefined) continue;
    if (!nonnegativeInteger(value)) invalid();
    result[field] = value;
  }
  for (const field of ["hasPreviewImage", "archived"] as const) {
    const value = file[field];
    if (value === undefined) continue;
    if (typeof value !== "boolean") invalid();
    result[field] = value;
  }
  return result;
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
    const detail = fileDetails(file, post);
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
