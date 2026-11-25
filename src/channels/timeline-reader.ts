import type {
  LocalChannelWindow,
  LocalPost,
} from "../mattermost/local-history.ts";
import { prepareFocusedConversation } from "./prepare-focused-conversation.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import {
  channelPageSize,
  observeWorkspaceRead,
  readTimelineEdge,
  type WorkspaceRead,
  workspaceFailure,
} from "./workspace-data.ts";

export type TimelineRequest =
  | {
      kind: "focus";
      requestId: number;
      rid: number;
      teamId: string;
      post: LocalPost;
    }
  | { kind: "latest"; requestId: number };
export type TimelineAccount = Pick<
  WorkspaceConnection,
  "rid" | "readChannelWindow" | "refreshChannelHistory"
>;

type Direction = "older" | "newer";
type Edge = { direction: Direction; postId: string };
type Status =
  | WorkspaceRead<LocalChannelWindow>["status"]
  | "unavailable"
  | "inaccessible"
  | "superseded";
type Snapshot = {
  status: Status;
  notice: Status | null;
  page: LocalChannelWindow | null;
  focus: {
    requestId: number;
    anchorId: string;
    focusedReply?: LocalPost;
  } | null;
  firstInaccessiblePostTime: number;
  latest: boolean;
  canRetry: boolean;
};

function empty(status: Status, latest = false, canRetry = true): Snapshot {
  return {
    status,
    notice: null,
    page: null,
    focus: null,
    firstInaccessiblePostTime: 0,
    latest,
    canRetry,
  };
}

// One reader owns one route and one position command. All publications belong to its current operation.
export function createTimelineReader(
  account: TimelineAccount,
  teamId: string,
  channelId: string | null,
  collapsedThreads: boolean | null,
  request?: TimelineRequest,
) {
  const target = request?.kind === "focus" ? request : undefined;
  const eligible =
    !target ||
    (target.rid === account.rid &&
      target.teamId === teamId &&
      target.post.channelId === channelId);
  let state = empty(
    eligible ? "loading" : "unavailable",
    !target && !!channelId,
    eligible,
  );
  const listeners = new Set<() => void>();
  let online: boolean | undefined;
  let pending: AbortController | undefined;
  let edge: Edge | undefined;
  let paged = false;

  function publish(next: Snapshot) {
    state = next;
    for (const listener of listeners) listener();
  }

  function clearPage(status: Status, cutoff = 0) {
    edge = undefined;
    publish({
      ...empty(status),
      // A denied or missing destination needs a newly resolved position. A local retry might resurrect its cached row.
      canRetry:
        status === "offline" ||
        status === "superseded" ||
        status === "storage" ||
        status === "network",
      firstInaccessiblePostTime: cutoff,
      notice:
        status === "superseded" ||
        status === "offline" ||
        status === "unavailable"
          ? status
          : null,
    });
  }

  async function read() {
    if (
      !state.canRetry ||
      !channelId ||
      collapsedThreads === null ||
      online === undefined
    )
      return;
    pending?.abort();
    const operation = new AbortController();
    pending = operation;
    const { signal } = operation;
    const scope = { channelId, collapsedThreads };
    try {
      if (edge && state.page) {
        const result = await readTimelineEdge(
          account,
          channelId,
          collapsedThreads,
          state.page,
          edge.direction,
          edge.postId,
          online,
          signal,
        );
        if (signal.aborted) return;
        if (result.status === "ready") {
          edge = undefined;
          paged = true;
          publish({
            ...state,
            page: result.page,
            latest: result.page.newer.kind === "end",
            status: "ready",
            notice: null,
            firstInaccessiblePostTime: result.page.firstInaccessiblePostTime,
          });
        } else if (result.status === "inaccessible") {
          clearPage(result.status, result.firstInaccessiblePostTime);
        } else if (result.status === "missing") {
          clearPage("unavailable");
        } else {
          publish({ ...state, notice: result.status });
        }
      } else if (target) {
        const result = await prepareFocusedConversation(
          account,
          target.post,
          collapsedThreads,
          signal,
          online,
        );
        if (signal.aborted) return;
        if (result.status === "ready") {
          const { page, anchorId, focusedReply } = result;
          publish({
            page,
            canRetry: true,
            focus: {
              requestId: target.requestId,
              anchorId,
              ...(focusedReply && { focusedReply }),
            },
            status: "ready",
            notice: null,
            latest: page.newer.kind === "end",
            firstInaccessiblePostTime: page.firstInaccessiblePostTime,
          });
        } else {
          clearPage(
            result.status,
            result.status === "inaccessible"
              ? result.firstInaccessiblePostTime
              : 0,
          );
        }
      } else {
        await observeWorkspaceRead({
          online,
          signal,
          read: () =>
            account.readChannelWindow({
              ...scope,
              kind: "latest",
              limit: channelPageSize,
            }),
          refresh: (signal) =>
            account.refreshChannelHistory(
              { ...scope, kind: "latest", perPage: channelPageSize },
              signal,
            ),
          publish: ({ value, status }) =>
            publish({
              ...empty(
                status,
                status !== "forbidden" &&
                  status !== "session" &&
                  status !== "unauthorized",
              ),
              page: value,
              firstInaccessiblePostTime: value?.firstInaccessiblePostTime ?? 0,
            }),
        });
      }
    } catch (error) {
      if (signal.aborted) return;
      const failure = workspaceFailure(error, "network");
      if (edge && (failure === "network" || failure === "storage"))
        publish({ ...state, notice: failure });
      else clearPage(failure);
    } finally {
      if (pending === operation) pending = undefined;
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setOnline(next: boolean) {
      const first = online === undefined;
      if (online === next) return;
      online = next;
      if (
        first ||
        pending ||
        state.notice === "offline" ||
        state.status === "offline"
      )
        void read();
      else if (!next && state.notice === "network" && edge)
        publish({ ...state, notice: "offline" });
      else if (
        !next &&
        (state.status === "network" ||
          (!target && !paged && state.status === "ready"))
      )
        publish({ ...state, status: "offline" });
    },
    stop() {
      online = undefined;
      pending?.abort();
      pending = undefined;
    },
    retry: read,
    async loadEdge(direction: Direction, postId: string) {
      const boundary = state.page?.[direction];
      if (
        online === undefined ||
        boundary?.kind !== "more" ||
        boundary.postId !== postId ||
        (pending && edge)
      )
        return;
      edge = { direction, postId };
      await read();
    },
  };
}
