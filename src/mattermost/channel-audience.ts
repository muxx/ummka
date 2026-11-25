import {
  ChannelsApi,
  type Configuration,
} from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";

export function accountChannelAudience(
  config: Configuration,
  whileOpen: <T>(read: () => Promise<T>) => Promise<T>,
) {
  const channels = new ChannelsApi(config);
  return {
    readChannelMemberCount(channelId: string, signal?: AbortSignal) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        if (!isMattermostId(channelId))
          throw new TypeError("Invalid Mattermost channel ID.");
        const stats = await channels.getChannelStats(
          { channelId, excludeFilesCount: true },
          { signal },
        );
        if (
          stats?.channelId !== channelId ||
          !Number.isSafeInteger(stats.memberCount) ||
          stats.memberCount < 0
        )
          throw new TypeError("Invalid Mattermost channel member count.");
        return stats.memberCount;
      });
    },
    readChannelTimezoneCount(channelId: string, signal?: AbortSignal) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        if (!isMattermostId(channelId))
          throw new TypeError("Invalid Mattermost channel ID.");
        const zones = await channels.getChannelMembersTimezones(
          { channelId },
          { signal },
        );
        if (zones === null) return 0;
        if (
          !Array.isArray(zones) ||
          !zones.every((zone) => typeof zone === "string")
        )
          throw new TypeError("Invalid Mattermost channel timezones.");
        return zones.length;
      });
    },
  };
}
