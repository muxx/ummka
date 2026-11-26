import type { LocalChannelWindow } from "../mattermost/local-history.ts";
import type { TimelineAccount } from "./timeline-reader.ts";
import type { ReadingPosition } from "./timeline-viewport.ts";
import { channelPageSize } from "./workspace-data.ts";

export async function readCommittedTimeline(
  account: Pick<TimelineAccount, "readChannelWindow">,
  scope: { channelId: string; collapsedThreads: boolean },
  position: ReadingPosition,
  signal: AbortSignal,
): Promise<{ page: LocalChannelWindow | null; positionLost: boolean }> {
  if (position === "latest") {
    const page = await account.readChannelWindow({
      ...scope,
      kind: "latest",
      limit: channelPageSize,
    });
    return { page, positionLost: false };
  }
  for (const postId of position) {
    signal.throwIfAborted();
    const page = await account.readChannelWindow({
      ...scope,
      kind: "around",
      postId,
      newer: channelPageSize / 2,
      older: channelPageSize / 2,
    });
    if (
      page?.posts.some(
        (row) => row.id === postId && row.channelId === scope.channelId,
      )
    )
      return { page, positionLost: false };
  }
  return { page: null, positionLost: true };
}
