import type {
  LocalChannelWindow,
  LocalPost,
} from "../mattermost/local-history.ts";
import { prepareFocusedConversation } from "./prepare-focused-conversation.ts";
import { readCommittedTimeline } from "./timeline-reprojection.ts";
import {
  type ReadingPosition,
  readingPosition,
  type TimelineViewport,
} from "./timeline-viewport.ts";
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
  | "rid"
  | "readChannelWindow"
  | "refreshChannelHistory"
  | "subscribeToChannelHistory"
>;

type Direction = "older" | "newer";
type Edge = { direction: Direction; postId: string };
type Status =
  | WorkspaceRead<LocalChannelWindow>["status"]
  | "unavailable"
  | "inaccessible"
  | "positionLost"
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
  let target = request?.kind === "focus" ? request : undefined;
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
  let pane: HTMLElement | null = null;
  let resize: ResizeObserver | undefined;
  const viewport: TimelineViewport = {
    get current() {
      return pane;
    },
    set current(next) {
      resize?.disconnect();
      resize = undefined;
      pane = next;
      if (changed && next) queueMicrotask(readChanges);
    },
  };
  let projection: AbortController | undefined;
  let changed = false;
  let retryChange = false;

  function position(visible: HTMLElement): ReadingPosition {
    return readingPosition(
      visible,
      !state.page || state.page.newer.kind === "end",
    );
  }

  async function readChanges() {
    if (
      !changed ||
      projection ||
      pending ||
      online === undefined ||
      !channelId ||
      collapsedThreads === null ||
      !state.canRetry ||
      !pane
    )
      return;
    if (!pane.clientHeight) {
      if (!resize) {
        resize = new ResizeObserver(() => {
          if (pane?.clientHeight) {
            resize?.disconnect();
            resize = undefined;
            void readChanges();
          }
        });
        resize.observe(pane);
      }
      return;
    }
    changed = false;
    const operation = new AbortController();
    projection = operation;
    const before = position(pane);
    try {
      const result = await readCommittedTimeline(
        account,
        { channelId, collapsedThreads },
        before,
        operation.signal,
      );
      if (operation.signal.aborted || changed) return;
      if (!pane?.clientHeight) {
        changed = true;
        return;
      }
      const after = position(pane);
      if (
        before === "latest"
          ? after !== "latest"
          : after === "latest" ||
            before.length !== after.length ||
            before.some((id, index) => after[index] !== id)
      ) {
        changed = true;
        return;
      }
      if (result.positionLost) {
        clearPage("positionLost");
      } else {
        const { page } = result;
        paged = before !== "latest";
        publish({
          ...state,
          page,
          status: online ? "ready" : "offline",
          notice: null,
          focus: page?.posts.some((post) => post.id === state.focus?.anchorId)
            ? state.focus
            : null,
          latest: page?.newer.kind === "end",
          firstInaccessiblePostTime: page?.firstInaccessiblePostTime ?? 0,
        });
      }
      retryChange = false;
    } catch (error) {
      if (!operation.signal.aborted && !changed) {
        const failure = workspaceFailure(error, "storage");
        if (failure === "storage") {
          retryChange = true;
          publish({ ...state, notice: failure });
        } else clearPage(failure);
      }
    } finally {
      if (projection === operation) projection = undefined;
      if (changed) void readChanges();
    }
  }

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
    retryChange = false;
    projection?.abort();
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
      if (changed) void readChanges();
    }
  }

  return {
    viewport,
    watchChanges() {
      if (!channelId || !eligible || collapsedThreads === null) return;
      return account.subscribeToChannelHistory(channelId, (source) => {
        if (source && pending?.signal === source) return;
        changed = true;
        void readChanges();
      });
    },
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
        !first &&
        next &&
        !pending &&
        !edge &&
        paged &&
        state.page &&
        state.status === "offline"
      ) {
        publish({ ...state, status: "ready" });
        return;
      }
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
      changed = false;
      resize?.disconnect();
      resize = undefined;
      projection?.abort();
      pending?.abort();
      pending = undefined;
    },
    retry() {
      if (!retryChange) return read();
      changed = true;
      return readChanges();
    },
    showLatest() {
      if (state.status !== "positionLost") return;
      target = undefined;
      paged = false;
      publish(empty("loading", true));
      return read();
    },
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
