import {
  ChannelsApi,
  type Configuration,
  type PostList,
  PostsApi,
} from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";
import { orderedItems } from "./ordered-items.ts";

const savedPageSize = 60;

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
  whileOpen: <T>(read: () => Promise<T>, signal?: AbortSignal) => Promise<T>,
) {
  const channels = new ChannelsApi(config);
  const posts = new PostsApi(config);
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
        // Both supported servers use the page query parameter directly as SQL OFFSET.
        const offset = page * savedPageSize;
        if (
          !Number.isSafeInteger(page) ||
          page < 0 ||
          !Number.isSafeInteger(offset)
        )
          throw new RangeError("Invalid Mattermost saved post page.");
        const filter = savedFilter(scope);
        const result = await posts.getFlaggedPostsForUser(
          { userId: "me", page: offset, perPage: savedPageSize, ...filter },
          { signal },
        );
        return collection(result, filter.channelId);
      }, signal);
    },
  };
}
