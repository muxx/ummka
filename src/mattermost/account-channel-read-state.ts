import {
  type ApiResponse,
  ChannelsApi,
  type ChannelUnreadAt,
  type Configuration,
  PostsApi,
  type ViewChannel200Response,
} from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

async function readConfirmation<T>(response: ApiResponse<T>) {
  if (response.raw.status !== 200) {
    void response.raw.body?.cancel().catch(() => {});
    throw new TypeError("Mattermost did not confirm the channel read state.");
  }
  return response.value();
}

async function confirmedViews(
  response: ApiResponse<ViewChannel200Response>,
  requested: Set<string>,
): Promise<Record<string, number>> {
  const result = await readConfirmation(response);
  const times = result?.lastViewedAtTimes;
  if (
    result?.status !== "OK" ||
    !times ||
    typeof times !== "object" ||
    Array.isArray(times) ||
    !Object.entries(times).every(
      ([id, time]) => requested.has(id) && isMattermostTime(time, 0),
    )
  )
    throw new TypeError("Invalid Mattermost channel view times.");
  return times;
}

function confirmUnread(
  row: ChannelUnreadAt | null,
  userId: string,
  channelId: string,
): asserts row is Required<ChannelUnreadAt> {
  if (
    row?.userId !== userId ||
    row.channelId !== channelId ||
    (row.teamId !== "" && !isMattermostId(row.teamId)) ||
    ![
      row.lastViewedAt,
      row.msgCount,
      row.msgCountRoot,
      row.mentionCount,
      row.mentionCountRoot,
      row.urgentMentionCount,
    ].every((value) => isMattermostTime(value, 0))
  )
    throw new TypeError(
      "Invalid unread state for the selected Mattermost channel.",
    );
}

export function accountChannelReadState(
  config: Configuration,
  userId: string,
  whileOpen: <T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ) => Promise<T>,
) {
  const channels = new ChannelsApi(config);
  const posts = new PostsApi(config);
  return {
    markPostUnread(channelId: string, postId: string, signal?: AbortSignal) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        if (
          !isMattermostId(channelId) ||
          !isMattermostId(postId) ||
          !isMattermostId(userId)
        )
          throw new TypeError("Invalid account or post to mark unread.");
        const response = await posts.setPostUnreadRaw(
          {
            userId: "me",
            postId,
            setPostUnreadRequest: { collapsedThreadsSupported: true },
          },
          { signal },
        );
        const row = await readConfirmation(response);
        confirmUnread(row, userId, channelId);
        return row;
      }, signal);
    },
    viewChannel(channelId: string | null, signal?: AbortSignal) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        if (channelId !== null && !isMattermostId(channelId))
          throw new TypeError("Invalid channel to view.");
        const requested = new Set(channelId === null ? [] : [channelId]);
        const response = await channels.viewChannelRaw(
          {
            userId: "me",
            viewChannelRequest: {
              channelId: channelId ?? "",
              collapsedThreadsSupported: true,
            },
          },
          { signal },
        );
        return confirmedViews(response, requested);
      }, signal);
    },
    markChannelsRead(channelIds: readonly string[], signal?: AbortSignal) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        if (!Array.isArray(channelIds) || !channelIds.length)
          throw new TypeError("Expected channels to mark as read.");
        const requested = new Set<string>();
        for (const id of channelIds) {
          if (!isMattermostId(id))
            throw new TypeError("Invalid channel to mark as read.");
          requested.add(id);
        }
        const response = await channels.markChannelsReadForUserRaw(
          {
            userId: "me",
            requestBody: [...requested],
          },
          { signal },
        );
        return confirmedViews(response, requested);
      }, signal);
    },
  };
}
