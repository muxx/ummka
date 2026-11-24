import type {
  GetPostsForChannelRequest,
  PostsApi,
} from "../../vendor/mattermost/index.js";
import { channelHistoryPage } from "./channel-history-page.ts";
import {
  assembleFocusedHistory,
  readFocusedNeighbors,
} from "./focused-history.ts";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

export type ChannelRefreshRequest = {
  channelId: string;
  collapsedThreads: boolean;
  collapsedThreadsExtended?: boolean;
  skipFetchThreads?: boolean;
} & (
  | { kind: "latest"; perPage?: number }
  | { kind: "before" | "after" | "focused"; postId: string; perPage?: number }
  | { kind: "since"; since: number }
);

export type ChannelRefreshResult =
  | { kind: "applied" | "superseded" }
  | { kind: "inaccessible"; firstInaccessiblePostTime: number };

interface ChannelHistoryWriter {
  begin(channelId: string): Promise<number>;
  store(
    load: number,
    page: ReturnType<typeof channelHistoryPage>,
  ): Promise<ChannelRefreshResult>;
  cancel(load: number): Promise<void>;
}

function checkRequest(request: ChannelRefreshRequest) {
  if (
    !isMattermostId(request.channelId) ||
    typeof request.collapsedThreads !== "boolean" ||
    [request.skipFetchThreads, request.collapsedThreadsExtended].some(
      (flag) => flag !== undefined && typeof flag !== "boolean",
    )
  )
    throw new TypeError("Invalid Mattermost channel or thread mode.");
  if (request.kind === "since") {
    if (!isMattermostTime(request.since, 1))
      throw new RangeError("Invalid history update time.");
    return;
  }
  if (!["latest", "focused", "before", "after"].includes(request.kind))
    throw new TypeError("Invalid history operation.");
  if (request.kind !== "latest" && !isMattermostId(request.postId))
    throw new TypeError("Invalid history anchor.");
  const size = request.perPage ?? 60;
  if (!Number.isInteger(size) || size < 1 || size > 200)
    throw new RangeError("Expected a channel page size between 1 and 200.");
}

async function fetchPage(
  api: PostsApi,
  request: ChannelRefreshRequest,
  signal: AbortSignal,
) {
  const {
    channelId,
    collapsedThreads,
    collapsedThreadsExtended = false,
    skipFetchThreads = false,
  } = request;
  const mode = { collapsedThreads, collapsedThreadsExtended, skipFetchThreads };
  if (request.kind === "focused") {
    const anchorId = request.postId;
    const [neighbors, thread] = await Promise.all([
      readFocusedNeighbors(
        api,
        { channelId, anchorId, ...mode, perPage: request.perPage ?? 30 },
        signal,
      ),
      api.getPostThread(
        { postId: anchorId, ...mode, direction: "down", perPage: 60 },
        { signal },
      ),
    ]);
    return channelHistoryPage(
      { channelId, collapsedThreads, focusedPostId: anchorId },
      assembleFocusedHistory({ anchorId, thread, ...neighbors }),
    );
  }
  const query: GetPostsForChannelRequest = { channelId, ...mode };
  if (request.kind === "since") {
    query.since = request.since;
  } else {
    query.page = 0;
    query.perPage = request.perPage ?? 60;
    if (request.kind === "before" || request.kind === "after")
      query[request.kind] = request.postId;
  }
  return channelHistoryPage(
    query,
    await api.getPostsForChannel(query, { signal }),
  );
}

/** Take the account's SQLite revision before starting any HTTP work. */
export async function refreshChannelHistory(
  api: PostsApi,
  writer: ChannelHistoryWriter,
  input: ChannelRefreshRequest,
  signal?: AbortSignal,
): Promise<ChannelRefreshResult> {
  signal?.throwIfAborted();
  const request = { ...input };
  checkRequest(request);
  const load = await writer.begin(request.channelId);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  let page: ReturnType<typeof channelHistoryPage>;
  try {
    signal?.throwIfAborted();
    page = await fetchPage(api, request, controller.signal);
    signal?.throwIfAborted();
  } catch (error) {
    // For a focus request, stop the sibling reads before releasing their shared ticket.
    controller.abort(error);
    await writer.cancel(load);
    throw signal?.aborted ? signal.reason : error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  // The host consumes a ticket before parsing the page and owns this transaction to completion.
  return writer.store(load, page);
}
