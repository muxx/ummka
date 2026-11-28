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

export type LocalPost = Omit<Saved, "kind">;

export interface LocalChannelWindow {
  posts: LocalPost[];
  newer: Edge;
  older: Edge;
  firstInaccessiblePostTime: number;
}

export type LiveHistoryAccess =
  | { kind: "cutoff"; time: number }
  | { kind: "unavailable"; postId: string };
