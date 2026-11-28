import {
  AppErrorFromJSON,
  BookmarksApi,
  type ChannelBookmarkWithFileInfo,
  type Configuration,
  ResponseError,
} from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";

export function parseBookmarkUrl(value: unknown) {
  if (
    typeof value !== "string" ||
    !(value.startsWith("http://") || value.startsWith("https://"))
  )
    return null;
  try {
    const url = new URL(value);
    return url.hostname ? url : null;
  } catch {
    return null;
  }
}

function bookmarkDestination(bookmark: ChannelBookmarkWithFileInfo) {
  switch (bookmark.type) {
    case "link": {
      const href = bookmark.linkUrl;
      if (typeof href === "string" && parseBookmarkUrl(href))
        return { kind: "link" as const, href };
      break;
    }
    case "file": {
      const { file, fileId } = bookmark;
      if (
        isMattermostId(fileId) &&
        (!file ||
          (file.id === fileId &&
            typeof file.name === "string" &&
            (file.mimeType === undefined || typeof file.mimeType === "string")))
      )
        return {
          kind: "file" as const,
          fileId,
          fileName: file?.name ?? null,
          fileMimeType: file?.mimeType || null,
        };
      break;
    }
    case "board": {
      const path = bookmark.linkUrl;
      if (
        isMattermostId(bookmark.targetId) &&
        typeof path === "string" &&
        path.startsWith("/") &&
        !path.startsWith("//") &&
        !path.includes("\\") &&
        !path.includes("://")
      )
        return { kind: "board" as const, targetId: bookmark.targetId, path };
      break;
    }
  }
  throw TypeError("Invalid Mattermost channel bookmark destination.");
}

export function activeChannelBookmark(
  row: ChannelBookmarkWithFileInfo,
  channelId: string,
) {
  if (
    !row ||
    !isMattermostId(row.id) ||
    row.channelId !== channelId ||
    row.deleteAt !== 0 ||
    typeof row.displayName !== "string" ||
    !row.displayName ||
    (row.emoji !== undefined && typeof row.emoji !== "string") ||
    (row.imageUrl !== undefined && typeof row.imageUrl !== "string")
  )
    throw TypeError("Invalid active Mattermost channel bookmark.");
  return {
    id: row.id,
    name: row.displayName,
    destination: bookmarkDestination(row),
    ...(row.emoji ? { emoji: row.emoji } : {}),
    ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
  };
}

export function activeChannelBookmarks(
  rows: ChannelBookmarkWithFileInfo[],
  channelId: string,
) {
  if (!Array.isArray(rows))
    throw TypeError("Invalid Mattermost channel bookmark list.");
  const ids = new Set<string>();
  return rows.map((row) => {
    const item = activeChannelBookmark(row, channelId);
    if (ids.has(item.id))
      throw TypeError("Duplicate Mattermost channel bookmark.");
    ids.add(item.id);
    return item;
  });
}

export async function readChannelBookmarks(
  config: Configuration,
  channelId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!isMattermostId(channelId))
    throw TypeError("Invalid Mattermost channel ID.");
  let rows: ChannelBookmarkWithFileInfo[];
  try {
    rows = await new BookmarksApi(config).listChannelBookmarksForChannel(
      { channelId },
      { signal },
    );
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof ResponseError) || error.response.status !== 501)
      throw error;
    let wire: unknown;
    try {
      wire = await error.response.clone().json();
    } catch {
      signal?.throwIfAborted();
      throw error;
    }
    signal?.throwIfAborted();
    const cause = AppErrorFromJSON(wire);
    if (
      cause?.statusCode === 501 &&
      cause.id === "api.channel.bookmark.channel_bookmark.license.error"
    )
      return { kind: "unlicensed" as const };
    throw error;
  }
  signal?.throwIfAborted();
  return {
    kind: "available" as const,
    bookmarks: activeChannelBookmarks(rows, channelId),
  };
}
