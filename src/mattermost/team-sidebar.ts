import { isMattermostId, isMattermostTime } from "./model-fields.ts";
import type { loadTeamDirectory } from "./navigation-data.ts";

function amount(value: number | undefined) {
  if (value === undefined) return null;
  if (!isMattermostTime(value, 0))
    throw new TypeError("Invalid Mattermost sidebar counter or time.");
  return value;
}

export function projectTeamSidebar({
  channels,
  categories,
}: Awaited<ReturnType<typeof loadTeamDirectory>>) {
  return {
    channels: channels.map(({ channel: c, membership: m }) => {
      if (
        !isMattermostId(c.id) ||
        !c.type ||
        c.name === undefined ||
        c.displayName === undefined ||
        !isMattermostTime(c.deleteAt, 0)
      )
        throw new TypeError("Invalid Mattermost channel identity.");
      return {
        id: c.id,
        kind: c.type,
        name: c.name,
        displayName: c.displayName,
        header: c.header ?? "",
        purpose: c.purpose ?? "",
        deleteAt: c.deleteAt,
        lastPostAt: amount(c.lastPostAt),
        lastRootPostAt: amount(c.lastRootPostAt),
        totalMsgCount: amount(c.totalMsgCount),
        totalMsgCountRoot: amount(c.totalMsgCountRoot),
        lastViewedAt: amount(m.lastViewedAt),
        msgCount: amount(m.msgCount),
        msgCountRoot: amount(m.msgCountRoot),
        mentionCount: amount(m.mentionCount),
        mentionCountRoot: amount(m.mentionCountRoot),
        urgentMentionCount: amount(m.urgentMentionCount),
        muted: m.notifyProps?.markUnread === "mention",
      };
    }),
    categories: categories.map((c) => {
      if (
        !c.id ||
        c.displayName === undefined ||
        !c.type ||
        !Array.isArray(c.channelIds) ||
        c.sorting === undefined ||
        c.collapsed === undefined ||
        c.muted === undefined
      )
        throw new TypeError("Invalid Mattermost sidebar category.");
      return {
        id: c.id,
        kind: c.type,
        displayName: c.displayName,
        sorting: c.sorting,
        collapsed: c.collapsed,
        muted: c.muted,
        channelIds: c.channelIds,
      };
    }),
  };
}
export type TeamSidebar = {
  data: ReturnType<typeof projectTeamSidebar>;
  selectedChannel: string | null;
};
