import {
  ChannelsApi,
  type Configuration,
  type PostList,
  PostsApi,
  PreferencesApi,
} from "../../vendor/mattermost/index.js";
import {
  assertAccountPreference,
  isMattermostId,
  isMattermostTime,
} from "./model-fields.ts";
import { orderedItems } from "./ordered-items.ts";

export const savedPageSize = 60;

type SavedScope =
  | { kind: "all" }
  | { kind: "channel"; channelId: string }
  | { kind: "team"; teamId: string };

function savedFilter(scope: SavedScope) {
  if (scope.kind === "all") return {};
  if (scope.kind === "channel" && isMattermostId(scope.channelId))
    return { channelId: scope.channelId };
  if (scope.kind === "team" && isMattermostId(scope.teamId))
    return { teamId: scope.teamId };
  throw new TypeError("Invalid Mattermost saved post scope.");
}

function collection(list: PostList, channelId?: string) {
  const firstInaccessiblePostTime = list?.firstInaccessiblePostTime;
  if (!isMattermostTime(firstInaccessiblePostTime, 0))
    throw new TypeError("Invalid Mattermost collection retention time.");
  const items = orderedItems(list.order, list.posts);
  const seen = new Set<string>();
  for (const row of items) {
    if (seen.has(row.id) || (channelId && row.channelId !== channelId))
      throw new TypeError("Invalid Mattermost collection membership.");
    seen.add(row.id);
  }
  return { items, firstInaccessiblePostTime };
}

export function accountPostCollections(
  config: Configuration,
  userId: string,
  whileOpen: <T>(read: () => Promise<T>, signal?: AbortSignal) => Promise<T>,
) {
  const channels = new ChannelsApi(config);
  const posts = new PostsApi(config);
  const preferences = new PreferencesApi(config);
  async function savedWindow(
    scope: SavedScope,
    offset: number,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new RangeError("Invalid Mattermost saved post offset.");
    const filter = savedFilter(scope);
    const result = await posts.getFlaggedPostsForUser(
      { userId: "me", page: offset, perPage: savedPageSize, ...filter },
      { signal },
    );
    return collection(result, filter.channelId);
  }
  return {
    readPinnedChannelPosts(channelId: string, signal?: AbortSignal) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        if (!isMattermostId(channelId))
          throw new TypeError("Invalid Mattermost pinned post channel.");
        const result = await channels.getPinnedPosts({ channelId }, { signal });
        return collection(result, channelId);
      }, signal);
    },
    readSavedPosts(scope: SavedScope, page: number, signal?: AbortSignal) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        if (!Number.isSafeInteger(page) || page < 0)
          throw new RangeError("Invalid Mattermost saved post page.");
        return savedWindow(scope, page * savedPageSize, signal);
      }, signal);
    },
    readSavedPostsAtOffset(
      scope: SavedScope,
      offset: number,
      signal?: AbortSignal,
    ) {
      return whileOpen(() => savedWindow(scope, offset, signal), signal);
    },
    readSavedPostPreferences(signal?: AbortSignal, returnedPostId?: string) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        if (returnedPostId !== undefined && !isMattermostId(returnedPostId))
          throw new TypeError("Invalid Mattermost saved post ID.");
        const rows = await preferences.getPreferences(
          { userId: "me" },
          { signal },
        );
        // A missing list is the server representation of an account with no preferences.
        let upperBound = 0;
        let returnedPostSaved = false;
        for (const row of rows ?? []) {
          assertAccountPreference(row, userId);
          if (row.category === "flagged_post") {
            upperBound++;
            returnedPostSaved ||= row.name === returnedPostId;
          }
        }
        return {
          upperBound,
          ...(returnedPostId !== undefined && { returnedPostSaved }),
        };
      }, signal);
    },
  };
}
