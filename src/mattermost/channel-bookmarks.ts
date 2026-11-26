import {
  AppErrorFromJSON,
  BookmarksApi,
  type ChannelBookmarkWithFileInfo,
  type Configuration,
  ResponseError,
} from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";

function bookmarkDestination(bookmark: ChannelBookmarkWithFileInfo) {
  switch (bookmark.type) {
    case "link": {
      const href = bookmark.linkUrl;
      if (
        typeof href === "string" &&
        (href.startsWith("http://") || href.startsWith("https://")) &&
        new URL(href).hostname
      )
        return { kind: "link" as const, href };
      break;
    }
    case "file": {
      const { file, fileId } = bookmark;
      if (
        isMattermostId(fileId) &&
        (!file || (file.id === fileId && typeof file.name === "string"))
      )
        return { kind: "file" as const, fileId, fileName: file?.name ?? null };
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
  const ids = new Set<string>();
  const bookmarks = rows.map((row) => {
    if (
      !row ||
      !isMattermostId(row.id) ||
      ids.has(row.id) ||
      row.channelId !== channelId ||
      row.deleteAt !== 0 ||
      typeof row.displayName !== "string" ||
      !row.displayName
    )
      throw TypeError("Invalid active Mattermost channel bookmark.");
    ids.add(row.id);
    return {
      id: row.id,
      name: row.displayName,
      destination: bookmarkDestination(row),
    };
  });
  return { kind: "available" as const, bookmarks };
}
