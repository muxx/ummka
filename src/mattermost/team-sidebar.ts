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
        (c.shared != null && typeof c.shared !== "boolean") ||
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
        createAt: amount(c.createAt),
        deleteAt: c.deleteAt,
        shared: c.shared === true,
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
        ...(m.roles === undefined ? {} : { roles: m.roles }),
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
type FreshSidebar = ReturnType<typeof projectTeamSidebar>;
type SavedChannel = Omit<FreshSidebar["channels"][number], "shared"> & {
  shared?: boolean;
};

export type TeamSidebar = {
  data: { categories: FreshSidebar["categories"]; channels: SavedChannel[] };
  selectedChannel: string | null;
};
