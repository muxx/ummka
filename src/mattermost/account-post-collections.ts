import {
  ChannelsApi,
  type Configuration,
  type PostList,
  PostsApi,
  PreferencesApi,
} from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";
import { orderedItems } from "./ordered-items.ts";
import { receivedResultPost } from "./received-result-post.ts";
import {
  createSavedPostState,
  projectSavedPostMembership,
  type SavedPostMembership,
} from "./saved-post-state.ts";

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
  return {
    items: items.map(receivedResultPost),
    firstInaccessiblePostTime,
  };
}

export function accountPostCollections(
  config: Configuration,
  userId: string,
  whileOpen: <T>(read: () => Promise<T>, signal?: AbortSignal) => Promise<T>,
  savedState = createSavedPostState(),
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
    getSavedPostState: savedState.get,
    getSavedPostUpperBound: savedState.getUpperBound,
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
    async readSavedPostPreferences(
      signal?: AbortSignal,
    ): Promise<SavedPostMembership> {
      signal?.throwIfAborted();
      const ticket = savedState.beginRead();
      try {
        const membership = await whileOpen(async () => {
          const rows = await preferences.getPreferences(
            { userId: "me" },
            { signal },
          );
          return projectSavedPostMembership(userId, rows);
        }, signal);
        if (!signal?.aborted) savedState.publish(ticket, membership);
        return membership;
      } catch (error) {
        if (!signal?.aborted) savedState.finishRead(ticket, error);
        throw error;
      } finally {
        savedState.finishRead(ticket);
      }
    },
  };
}
