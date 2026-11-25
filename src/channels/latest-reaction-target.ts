import type { LocalChannelWindow } from "../mattermost/local-history.ts";

type SavedPost = Pick<
  LocalChannelWindow["posts"][number],
  "id" | "channelId" | "rootId" | "type"
>;

/** Inspect the newest row first without reordering the stored window. */
export function latestReactionTarget(
  channelId: string,
  posts: readonly SavedPost[],
  rootId?: string,
  order: "newestFirst" | "oldestFirst" = "newestFirst",
): string | null {
  let root: string | null = null;
  for (let offset = 0; offset < posts.length; offset++) {
    const post =
      posts[order === "newestFirst" ? offset : posts.length - 1 - offset];
    if (post.channelId !== channelId || post.type.startsWith("system_"))
      continue;
    if (rootId === undefined || post.rootId === rootId) return post.id;
    if (post.id === rootId && post.rootId === null) root = post.id;
  }
  return root;
}
