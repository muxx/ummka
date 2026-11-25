import {
  type Configuration,
  FilesApi,
  PostsApi,
} from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

type SearchPageRequest = {
  teamId: string | null;
  terms: string;
  page: number;
  isOrSearch: boolean;
  includeDeletedChannels: boolean;
  timeZoneOffsetSeconds: number;
};

function parameters(request: SearchPageRequest) {
  if (request.teamId !== null && !isMattermostId(request.teamId))
    throw new TypeError("Invalid Mattermost search team.");
  if (typeof request.terms !== "string" || request.terms.length === 0)
    throw new TypeError("Missing Mattermost search terms.");
  if (
    !Number.isSafeInteger(request.page) ||
    request.page < 0 ||
    !Number.isSafeInteger(request.timeZoneOffsetSeconds)
  )
    throw new RangeError("Invalid Mattermost search page or timezone offset.");
  return {
    terms: request.terms,
    isOrSearch: request.isOrSearch,
    includeDeletedChannels: request.includeDeletedChannels,
    timeZoneOffset: request.timeZoneOffsetSeconds,
    page: request.page,
    perPage: 20,
  };
}

function orderedItems<T extends { id?: string; channelId?: string }>(
  order: string[],
  items: Record<string, T>,
) {
  if (
    !Array.isArray(order) ||
    !items ||
    typeof items !== "object" ||
    Array.isArray(items)
  )
    throw new TypeError("Invalid Mattermost search result list.");
  return order.map((id) => {
    const item = items[id];
    if (
      !isMattermostId(id) ||
      !Object.hasOwn(items, id) ||
      item?.id !== id ||
      !isMattermostId(item.channelId)
    )
      throw new TypeError("Invalid Mattermost search result identity.");
    return { ...item, id, channelId: item.channelId };
  });
}

function retentionBoundary(time: number) {
  if (!isMattermostTime(time, 0))
    throw new TypeError("Invalid Mattermost search retention time.");
  return time;
}

export function accountSearch(
  config: Configuration,
  whileOpen: <T>(read: () => Promise<T>) => Promise<T>,
) {
  const posts = new PostsApi(config),
    files = new FilesApi(config);
  return {
    readPostSearchPage(request: SearchPageRequest, signal?: AbortSignal) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        const params = parameters(request);
        const result =
          request.teamId === null
            ? await posts.searchPostsInAllTeams(
                { searchPostsInAllTeamsRequest: params },
                { signal },
              )
            : await posts.searchPosts(
                { teamId: request.teamId, searchPostsRequest: params },
                { signal },
              );
        signal?.throwIfAborted();
        const items = orderedItems(result.order, result.posts);
        const { matches } = result;
        if (
          matches !== null &&
          (!matches ||
            typeof matches !== "object" ||
            Array.isArray(matches) ||
            Object.values(matches).some(
              (strings) =>
                !Array.isArray(strings) ||
                !strings.every((word) => typeof word === "string"),
            ))
        )
          throw new TypeError("Invalid Mattermost post search matches.");
        return {
          items,
          matches,
          isEnd: items.length === 0,
          firstInaccessiblePostTime: retentionBoundary(
            result.firstInaccessiblePostTime,
          ),
        };
      });
    },
    readFileSearchPage(request: SearchPageRequest, signal?: AbortSignal) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        const params = parameters(request);
        const result =
          request.teamId === null
            ? await files.searchFilesInAllTeams(
                { searchFilesInAllTeamsRequest: params },
                { signal },
              )
            : await files.searchFiles(
                { teamId: request.teamId, searchFilesRequest: params },
                { signal },
              );
        signal?.throwIfAborted();
        const items = orderedItems(result.order, result.fileInfos).map(
          (file) => {
            if (
              file.postId !== undefined &&
              file.postId !== "" &&
              !isMattermostId(file.postId)
            )
              throw new TypeError(
                "Invalid post ID on a Mattermost file search result.",
              );
            // Files from a channel bookmark have a channel and no associated conversation post.
            return { ...file, postId: file.postId || null };
          },
        );
        return {
          items,
          isEnd: items.length === 0,
          firstInaccessibleFileTime: retentionBoundary(
            result.firstInaccessibleFileTime,
          ),
        };
      });
    },
  };
}
