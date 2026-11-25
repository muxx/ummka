import type { LocalChannelWindow } from "../mattermost/local-history.ts";

type SavedPost = Pick<
  LocalChannelWindow["posts"][number],
  "id" | "channelId" | "rootId" | "type"
>;

/** Use the latest saved window in server order. Local outgoing attempts are separate. */
export function latestReactionTarget(
  channelId: string,
  newestFirst: readonly SavedPost[],
  rootId?: string,
): string | null {
  let root: string | null = null;
  for (const post of newestFirst) {
    if (post.channelId !== channelId || post.type.startsWith("system_"))
      continue;
    if (rootId === undefined || post.rootId === rootId) return post.id;
    if (post.id === rootId && post.rootId === null) root = post.id;
  }
  return root;
}
