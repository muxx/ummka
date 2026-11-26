import {
  type ApiResponse,
  ChannelsApi,
  type Configuration,
  type ViewChannel200Response,
} from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

async function confirmedViews(
  response: ApiResponse<ViewChannel200Response>,
  requested: Set<string>,
): Promise<Record<string, number>> {
  if (response.raw.status !== 200) {
    void response.raw.body?.cancel().catch(() => {});
    throw new TypeError("Mattermost did not confirm channel views.");
  }
  const result = await response.value();
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

export function accountChannelViews(
  config: Configuration,
  whileOpen: <T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ) => Promise<T>,
) {
  const channels = new ChannelsApi(config);
  return {
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
