import { FetchError, ResponseError } from "../../vendor/mattermost/index.js";
import { directPartnerId } from "../mattermost/channel-profiles.ts";
import type { LocalChannelWindow } from "../mattermost/local-history.ts";
import type { openAccountRestConnection } from "../mattermost/native-rest.ts";
import { channelUnreadCounts } from "../mattermost/sidebar-rows.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import type { VisibleProfileQuery } from "../mattermost/visible-profiles.ts";
import type { WorkspacePreferences } from "../mattermost/workspace-preferences.ts";

type Connection = Awaited<ReturnType<typeof openAccountRestConnection>>;
type Failure = "network" | "storage" | "forbidden" | "unauthorized" | "session";
export type WorkspaceRead<T> = {
  value: T | null;
  status: "loading" | "refreshing" | "ready" | "offline" | Failure;
};
const localErrors = new Set([
  "history_storage_unavailable",
  "credential_storage_unavailable",
  "invalid_stored_credential",
  "invalid_directory",
  "invalid_history_request",
]);

export function workspaceFailure(
  error: unknown,
  source: "storage" | "network",
): Failure {
  if (error instanceof ResponseError) {
    void error.response.body?.cancel().catch(() => {});
    if (error.response.status === 401) return "unauthorized";
    if (error.response.status === 403 || error.response.status === 404)
      return "forbidden";
  }
  const native = error instanceof FetchError ? error.cause : error;
  const code = native instanceof TypeError ? native.cause : native;
  if (typeof code === "string") {
    if (
      code === "session_unavailable" ||
      code === "cancelled" ||
      code === "unknown_connection"
    )
      return "session";
    if (localErrors.has(code)) return "storage";
  }
  return source;
}

export function mayKeepCache(failure: Failure) {
  return failure === "network" || failure === "storage";
}

// Each observer belongs to one account and route. A superseding screen aborts its own observer.
export async function observeWorkspaceRead<T>({
  signal,
  online,
  read,
  refresh,
  publish,
}: {
  signal: AbortSignal;
  online: boolean;
  read: () => Promise<T | null>;
  refresh: (signal: AbortSignal) => Promise<unknown>;
  publish: (state: WorkspaceRead<T>) => void;
}) {
  if (signal.aborted) return;
  let value: T | null = null;
  let source: "storage" | "network" = "storage";
  try {
    value = await read();
    if (signal.aborted) return;
    publish({ value, status: online ? "refreshing" : "offline" });
    if (!online || signal.aborted) return;
    source = "network";
    await refresh(signal);
    if (signal.aborted) return;
    source = "storage";
    // Even a superseded ticket can leave a newer snapshot published by another process.
    const current = await read();
    if (!signal.aborted) publish({ value: current, status: "ready" });
  } catch (error) {
    if (signal.aborted) return;
    const status = workspaceFailure(error, source);
    publish({ value: mayKeepCache(status) ? value : null, status });
  }
}

export function openingChannel(snapshot: TeamSidebar, locale: string) {
  const { channels } = snapshot.data;
  if (snapshot.selectedChannel) {
    const saved = channels.find(
      (channel) => channel.id === snapshot.selectedChannel,
    );
    if (saved) return saved;
  }
  const compare = new Intl.Collator(locale, { numeric: true }).compare;
  let first: (typeof channels)[number] | undefined;
  for (const channel of channels) {
    if (channel.deleteAt || (channel.kind !== "O" && channel.kind !== "P"))
      continue;
    if (channel.kind === "O" && channel.name === "town-square") return channel;
    if (!first || compare(channel.displayName, first.displayName) < 0)
      first = channel;
  }
  return first ?? null;
}

export function workspaceProfileQuery(
  userId: string,
  sidebar: TeamSidebar | null,
  policy: WorkspacePreferences | null,
  page: LocalChannelWindow | null,
): VisibleProfileQuery {
  const ids = new Set<string>([userId]),
    usernames = new Set<string>();
  for (const post of page?.posts ?? []) ids.add(post.userId);
  if (sidebar && policy)
    for (const channel of sidebar.data.channels) {
      if (channel.kind !== "D" && channel.kind !== "G") continue;
      const current = sidebar.selectedChannel === channel.id;
      if (channel.deleteAt && !current) continue;
      const peer =
        channel.kind === "D" ? directPartnerId(channel.name, userId) : null;
      const { unread } = channelUnreadCounts(channel, policy.collapsedThreads);
      if (
        !current &&
        !unread &&
        !(peer ? policy.directShown[peer] : policy.groupShown[channel.id])
      )
        continue;
      if (peer) ids.add(peer);
      if (channel.kind === "G")
        for (const name of channel.displayName.split(", "))
          if (name.trim()) usernames.add(name);
    }
  return { ids: [...ids], usernames: [...usernames] };
}

export const channelPageSize = 60;
type TimelineConnection = Pick<
  Connection,
  "readChannelWindow" | "refreshChannelHistory"
>;
export type EdgeResult =
  | { status: "ready"; page: LocalChannelWindow }
  | { status: "offline" | "unavailable" };

// Keep part of the old screen in the new window, allowing the scroller to anchor actual rows.
export async function readTimelineEdge(
  connection: TimelineConnection,
  channelId: string,
  collapsedThreads: boolean,
  current: LocalChannelWindow,
  direction: "older" | "newer",
  edgeId: string,
  online: boolean,
  signal: AbortSignal,
): Promise<EdgeResult> {
  signal.throwIfAborted();
  const edge = current[direction];
  const boundary =
    direction === "older" ? current.posts.at(-1) : current.posts[0];
  if (edge.kind !== "more" || edge.postId !== edgeId || !boundary)
    return { status: "unavailable" };
  const scope = { channelId, collapsedThreads };
  const query = {
    ...scope,
    kind: "around" as const,
    postId: boundary.id,
    newer: direction === "newer" ? channelPageSize : 20,
    older: direction === "older" ? channelPageSize : 20,
  };
  const advanced = (page: LocalChannelWindow | null) => {
    const index = page?.posts.findIndex((p) => p.id === boundary.id) ?? -1;
    return (
      page &&
      index >= 0 &&
      (direction === "older" ? index < page.posts.length - 1 : index > 0)
    );
  };
  const cached = await connection.readChannelWindow(query);
  signal.throwIfAborted();
  if (cached && (advanced(cached) || cached[direction].kind === "end"))
    return { status: "ready", page: cached };
  if (!online) return { status: "offline" };
  await connection.refreshChannelHistory(
    {
      ...scope,
      kind: direction === "older" ? "before" : "after",
      postId: boundary.id,
      perPage: channelPageSize,
    },
    signal,
  );
  signal.throwIfAborted();
  const published = await connection.readChannelWindow(query);
  signal.throwIfAborted();
  return published &&
    (advanced(published) || published[direction].kind === "end")
    ? { status: "ready", page: published }
    : { status: "unavailable" };
}
