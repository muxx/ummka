import type { channelPostChanges } from "./channel-post-records.ts";

type Saved = Extract<
  ReturnType<typeof channelPostChanges>[number],
  { kind: "save" }
>;
type ChannelScope = { channelId: string; collapsedThreads: boolean };

export type ChannelWindowQuery = ChannelScope &
  (
    | { kind: "latest"; limit: number }
    | { kind: "around"; postId: string; newer: number; older: number }
  );

type Edge = { kind: "end" | "unknown" } | { kind: "more"; postId: string };

export interface LocalChannelWindow {
  posts: Omit<Saved, "kind">[];
  newer: Edge;
  older: Edge;
  firstInaccessiblePostTime: number;
}
