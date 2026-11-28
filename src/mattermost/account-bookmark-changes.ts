import {
  type ApiResponse,
  BookmarksApi,
  type ChannelBookmarkWithFileInfo,
  type Configuration,
  type UpdateChannelBookmarkRequest,
} from "../../vendor/mattermost/index.js";
import {
  activeChannelBookmark,
  activeChannelBookmarks,
  parseBookmarkUrl,
} from "./channel-bookmarks.ts";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

type Draft = { displayName: string; emoji?: string } & (
  | { type: "link"; linkUrl: string; imageUrl?: string }
  | { type: "file"; fileId: string }
);

type Change = Pick<
  UpdateChannelBookmarkRequest,
  "displayName" | "emoji" | "imageUrl" | "linkUrl" | "fileId"
>;
type Target = Pick<
  ReturnType<typeof activeChannelBookmark>,
  "id" | "destination"
>;

function checkChannel(channelId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!isMattermostId(channelId))
    throw TypeError("Invalid Mattermost channel ID.");
}

function checkEditable(target: Target) {
  if (
    !isMattermostId(target?.id) ||
    (target.destination?.kind !== "link" && target.destination?.kind !== "file")
  )
    throw TypeError("Invalid editable Mattermost bookmark.");
}

function isWritableUrl(value: unknown) {
  const url = parseBookmarkUrl(value);
  return (
    typeof value === "string" &&
    url !== null &&
    !url.username &&
    !url.password &&
    [...value].length <= 1024
  );
}

function checkFields(kind: string, fields: Change) {
  const { displayName, emoji, imageUrl, linkUrl, fileId } = fields;
  const patch = { displayName, emoji, imageUrl, linkUrl, fileId };
  if (Object.keys(fields).some((key) => !Object.hasOwn(patch, key)))
    throw TypeError("Unsupported Mattermost bookmark field.");
  if (
    displayName !== undefined &&
    (typeof displayName !== "string" ||
      !displayName ||
      [...displayName].length > 64)
  )
    throw TypeError("Invalid Mattermost bookmark name.");
  if (emoji !== undefined && typeof emoji !== "string")
    throw TypeError("Invalid Mattermost bookmark emoji.");
  if (linkUrl !== undefined && (kind !== "link" || !isWritableUrl(linkUrl)))
    throw TypeError("Invalid Mattermost bookmark URL.");
  if (
    imageUrl !== undefined &&
    (kind !== "link" || (imageUrl !== "" && !isWritableUrl(imageUrl)))
  )
    throw TypeError("Invalid Mattermost bookmark image.");
  if (fileId !== undefined && (kind !== "file" || !isMattermostId(fileId)))
    throw TypeError("Invalid Mattermost bookmark file ID.");
  return patch;
}

function deletedId(
  row: ChannelBookmarkWithFileInfo | undefined,
  channelId: string,
  target: Target,
) {
  if (
    row?.id !== target.id ||
    row.channelId !== channelId ||
    row.type !== target.destination.kind ||
    !isMattermostTime(row.deleteAt, 1)
  )
    throw TypeError(
      "Mattermost did not confirm deletion of the requested bookmark.",
    );
  return target.id;
}

async function confirmed<T>(
  pending: Promise<ApiResponse<T>>,
  status: number,
  signal: AbortSignal,
) {
  try {
    const result = await pending;
    signal.throwIfAborted();
    if (result.raw.status !== status) {
      await result.raw.body?.cancel();
      throw TypeError("Unexpected Mattermost bookmark response status.");
    }
    const value = await result.value();
    signal.throwIfAborted();
    return value;
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
}

export function accountBookmarkChanges(
  config: Configuration,
  userId: string,
  whileOpen: <T>(
    operation: (active: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ) => Promise<T>,
) {
  const api = new BookmarksApi(config);
  return {
    createChannelBookmark(
      channelId: string,
      draft: Draft,
      signal?: AbortSignal,
    ) {
      return whileOpen(async (active) => {
        checkChannel(channelId, active);
        if (
          !draft?.displayName ||
          !(
            (draft.type === "link" && draft.linkUrl) ||
            (draft.type === "file" && draft.fileId)
          )
        )
          throw TypeError("Incomplete Mattermost bookmark.");
        const { type, ...requested } = draft;
        const fields = checkFields(type, requested);
        const created = await confirmed(
          api.createChannelBookmarkRaw(
            {
              channelId,
              createChannelBookmarkRequest: {
                ...fields,
                displayName: draft.displayName,
                type: draft.type,
              },
            },
            { signal: active },
          ),
          201,
          active,
        );
        const item = activeChannelBookmark(created, channelId);
        if (
          created.ownerId !== userId ||
          !(
            (draft.type === "file" &&
              item.destination.kind === "file" &&
              item.destination.fileId === draft.fileId) ||
            (draft.type === "link" &&
              item.destination.kind === "link" &&
              item.destination.href === draft.linkUrl)
          )
        )
          throw TypeError(
            "Mattermost confirmed a different bookmark destination.",
          );
        return item;
      }, signal);
    },
    updateChannelBookmark(
      channelId: string,
      target: Target,
      changes: Change,
      signal?: AbortSignal,
    ) {
      return whileOpen(async (active) => {
        checkChannel(channelId, active);
        checkEditable(target);
        const patch = checkFields(target.destination.kind, changes);
        if (Object.values(patch).every((value) => value === undefined))
          throw TypeError("Empty Mattermost bookmark change.");
        const response = await confirmed(
          api.updateChannelBookmarkRaw(
            {
              channelId,
              bookmarkId: target.id,
              updateChannelBookmarkRequest: patch,
            },
            { signal: active },
          ),
          200,
          active,
        );
        if (!response?.updated)
          throw TypeError("Missing updated Mattermost bookmark.");
        const updated = activeChannelBookmark(response.updated, channelId);
        const removedId = response.deleted
          ? deletedId(response.deleted, channelId, target)
          : null;
        if (
          response.updated.ownerId !== userId ||
          updated.destination.kind !== target.destination.kind ||
          (updated.id !== target.id) !== (removedId !== null) ||
          (response.deleted &&
            (!isMattermostId(response.deleted.ownerId) ||
              response.deleted.ownerId === userId ||
              response.updated.originalId !== target.id)) ||
          (patch.linkUrl !== undefined &&
            response.updated.linkUrl !== patch.linkUrl) ||
          (patch.fileId !== undefined &&
            response.updated.fileId !== patch.fileId) ||
          (patch.imageUrl !== undefined &&
            (response.updated.imageUrl ?? "") !== patch.imageUrl) ||
          (patch.emoji !== undefined &&
            (response.updated.emoji ?? "") !==
              patch.emoji.replace(/^:+|:+$/g, ""))
        )
          throw TypeError("Mattermost confirmed a different bookmark change.");
        return { updated, removedId };
      }, signal);
    },
    deleteChannelBookmark(
      channelId: string,
      target: Target,
      signal?: AbortSignal,
    ) {
      return whileOpen(async (active) => {
        checkChannel(channelId, active);
        checkEditable(target);
        const row = await confirmed(
          api.deleteChannelBookmarkRaw(
            { channelId, bookmarkId: target.id },
            { signal: active },
          ),
          200,
          active,
        );
        return deletedId(row, channelId, target);
      }, signal);
    },
    moveChannelBookmark(
      channelId: string,
      bookmarkId: string,
      position: number,
      signal?: AbortSignal,
    ) {
      return whileOpen(async (active) => {
        checkChannel(channelId, active);
        if (
          !isMattermostId(bookmarkId) ||
          !Number.isSafeInteger(position) ||
          position < 0
        )
          throw TypeError("Invalid Mattermost bookmark position.");
        const rows = await confirmed(
          api.updateChannelBookmarkSortOrderRaw(
            { channelId, bookmarkId, body: position },
            { signal: active },
          ),
          200,
          active,
        );
        const result = activeChannelBookmarks(rows, channelId);
        if (
          result[position]?.id !== bookmarkId ||
          rows.some((row, i) => row.sortOrder !== i)
        )
          throw TypeError("Mattermost confirmed a different bookmark order.");
        return result;
      }, signal);
    },
  };
}
