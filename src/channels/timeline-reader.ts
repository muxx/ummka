import type {
  LocalChannelWindow,
  LocalPost,
} from "../mattermost/local-history.ts";
import {
  type PreparedConversation,
  prepareFocusedConversation,
} from "./prepare-focused-conversation.ts";
import { readCommittedTimeline } from "./timeline-reprojection.ts";
import {
  type ReadingPosition,
  readingPosition,
  type TimelinePlace,
  type TimelineViewport,
} from "./timeline-viewport.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import {
  channelPageSize,
  type HistoryPageFailure,
  historyPageFailure,
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
      prepared?: PreparedConversation;
    }
  | { kind: "latest"; requestId: number }
  | { kind: "restore"; requestId: number; position: readonly string[] }
  | {
      kind: "return";
      requestId: number;
      rid: number;
      teamId: string;
      collapsedThreads: boolean;
      window?: RetainedChannelWindow;
    };

export type RetainedChannelWindow = {
  page: LocalChannelWindow;
  place: TimelinePlace;
  composerHeight?: number;
};
export type ChannelHistoryAccess = { revoked: boolean; cutoff: number };

export type TimelineAccount = Pick<
  WorkspaceConnection,
  | "rid"
  | "readChannelWindow"
  | "refreshChannelHistory"
  | "subscribeToChannelHistory"
>;

export type TimelineDirection = "older" | "newer";
type Edge = { direction: TimelineDirection; postId: string };
type EdgeRead = { postId: string } & (
  | { status: "loading" }
  | { status: "error"; reason: HistoryPageFailure }
);
export type TimelineEdgeReads = Partial<Record<TimelineDirection, EdgeRead>>;
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
  edges: TimelineEdgeReads;
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
    edges: {},
    focus: null,
    firstInaccessiblePostTime: 0,
    latest,
    canRetry,
  };
}

function sameReading(before: ReadingPosition, after: ReadingPosition) {
  return before === "latest" || after === "latest"
    ? before === after
    : before.length === after.length &&
        before.every((id, index) => after[index] === id);
}

function restrictedPage(
  page: LocalChannelWindow,
  cutoff: number,
): LocalChannelWindow {
  if (!cutoff && !page.firstInaccessiblePostTime) return page;
  const boundary = Math.max(cutoff, page.firstInaccessiblePostTime);
  const posts = page.posts.filter((post) => post.createAt > boundary);
  if (
    posts.length === page.posts.length &&
    boundary === page.firstInaccessiblePostTime
  )
    return page;
  return {
    ...page,
    posts,
    firstInaccessiblePostTime: boundary,
    older: posts.length < page.posts.length ? { kind: "end" } : page.older,
  };
}

// One reader owns one route and one position command. All publications belong to its current operation.
export function createTimelineReader(
  account: TimelineAccount,
  teamId: string,
  channelId: string | null,
  collapsedThreads: boolean | null,
  request?: TimelineRequest,
  rememberedAccess?: ChannelHistoryAccess,
) {
  let target = request?.kind === "focus" ? request : undefined;
  let prepared = target?.prepared;
  let restored = request?.kind === "restore" ? request.position : undefined;
  const returning = request?.kind === "return" ? request : undefined;
  const eligible =
    (!target ||
      (target.rid === account.rid &&
        target.teamId === teamId &&
        target.post.channelId === channelId)) &&
    (!returning ||
      (returning.rid === account.rid &&
        returning.teamId === teamId &&
        returning.collapsedThreads === collapsedThreads &&
        returning.window?.page.posts.every(
          (post) => post.channelId === channelId,
        ) === true));
  let needsProof = !target && rememberedAccess?.revoked === true;
  const retained = eligible && !needsProof ? returning?.window : undefined;
  let returnPlace = retained?.place;
  let confirmedCutoff = Math.max(
    retained?.page.firstInaccessiblePostTime ?? 0,
    !target ? (rememberedAccess?.cutoff ?? 0) : 0,
  );
  let state = empty(
    eligible ? "loading" : "unavailable",
    !target && !!channelId,
    eligible,
  );
  if (needsProof) state = { ...state, notice: "forbidden" };
  if (retained) {
    const page = restrictedPage(retained.page, confirmedCutoff);
    state = {
      ...state,
      page,
      latest: page.newer.kind === "end",
      firstInaccessiblePostTime: page.firstInaccessiblePostTime,
    };
  }
  const listeners = new Set<() => void>();
  let online: boolean | undefined;
  let pending: AbortController | undefined;
  let activeEdge: Edge | undefined;
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
      needsProof ||
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
      if (!sameReading(before, after)) {
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
    if (next.page && confirmedCutoff) {
      const page = restrictedPage(next.page, confirmedCutoff);
      if (!page.posts.length) {
        clearPage("inaccessible", confirmedCutoff);
        return;
      }
      next = {
        ...next,
        page,
        firstInaccessiblePostTime: page.firstInaccessiblePostTime,
      };
    }
    // A publication can replace a boundary even when this reader did not request it.
    const edges = { ...next.edges };
    for (const direction of ["older", "newer"] as const) {
      const boundary = next.page?.[direction];
      if (
        boundary?.kind !== "more" ||
        boundary.postId !== edges[direction]?.postId
      )
        delete edges[direction];
    }
    state = { ...next, edges };
    for (const listener of listeners) listener();
  }

  function clearPage(status: Status, cutoff = 0) {
    returnPlace = undefined;
    publish({
      ...empty(status),
      // A denied or missing destination needs a newly resolved position. A local retry might resurrect its cached row.
      canRetry:
        status === "offline" ||
        status === "superseded" ||
        status === "storage" ||
        status === "network",
      firstInaccessiblePostTime: cutoff,
      notice: needsProof
        ? "forbidden"
        : status === "superseded" ||
            status === "offline" ||
            status === "unavailable"
          ? status
          : null,
    });
  }

  function failEdge({ direction, postId }: Edge, reason: HistoryPageFailure) {
    publish({
      ...state,
      edges: {
        ...state.edges,
        [direction]: { postId, status: "error", reason },
      },
    });
  }

  async function read(edge?: Edge) {
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
    activeEdge = edge;
    const { signal } = operation;
    const scope = { channelId, collapsedThreads };
    try {
      if (edge && state.page) {
        const page = state.page;
        const { direction, postId } = edge;
        publish({
          ...state,
          edges: { ...state.edges, [direction]: { postId, status: "loading" } },
        });
        const result = await readTimelineEdge(
          account,
          channelId,
          collapsedThreads,
          page,
          direction,
          postId,
          online,
          signal,
        );
        if (signal.aborted) return;
        if (result.status === "ready") {
          const edges = { ...state.edges };
          delete edges[direction];
          paged = true;
          publish({
            ...state,
            page: result.page,
            edges,
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
          failEdge(edge, result.status === "offline" ? "offline" : "unknown");
        }
      } else if (target) {
        const result =
          prepared ??
          (await prepareFocusedConversation(
            account,
            target.post,
            collapsedThreads,
            signal,
            online,
          ));
        prepared = undefined;
        if (signal.aborted) return;
        if (result.status === "ready") {
          const { page, anchorId, focusedReply } = result;
          publish({
            page,
            edges: state.edges,
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
      } else if (returnPlace || needsProof || confirmedCutoff) {
        if (needsProof && !online) {
          publish({ ...empty("offline"), notice: "forbidden" });
          return;
        }
        const refresh = online
          ? await account.refreshChannelHistory(
              { ...scope, kind: "latest", perPage: channelPageSize },
              signal,
            )
          : undefined;
        if (signal.aborted) return;
        if (needsProof && refresh?.kind === "superseded") {
          clearPage("superseded", confirmedCutoff);
          return;
        }
        if (refresh?.kind === "applied" || refresh?.kind === "inaccessible") {
          needsProof = false;
          const cutoff = refresh.firstInaccessiblePostTime ?? 0;
          if (cutoff > confirmedCutoff) {
            confirmedCutoff = cutoff;
            publish(state);
            if (!state.canRetry) return;
          }
        }
        const place = returnPlace;
        const saved: ReadingPosition =
          !place || (place.atBottom && state.latest)
            ? "latest"
            : place.anchors
                .filter(({ published }) => published)
                .map(({ id }) => id);
        const before = place && pane?.clientHeight ? position(pane) : saved;
        const result = await readCommittedTimeline(
          account,
          scope,
          before,
          signal,
        );
        if (signal.aborted) return;
        if (
          place &&
          pane?.clientHeight &&
          !sameReading(before, position(pane))
        ) {
          changed = true;
          return;
        }
        if (result.positionLost || !result.page) clearPage("positionLost");
        else {
          const { page } = result;
          confirmedCutoff = Math.max(
            confirmedCutoff,
            page.firstInaccessiblePostTime,
          );
          paged = before !== "latest";
          publish({
            ...empty(online ? "ready" : "offline", page.newer.kind === "end"),
            page,
            edges: state.edges,
            firstInaccessiblePostTime: page.firstInaccessiblePostTime,
          });
        }
      } else if (restored) {
        const result = await readCommittedTimeline(
          account,
          scope,
          restored,
          signal,
        );
        if (signal.aborted) return;
        if (result.positionLost || !result.page) clearPage("positionLost");
        else {
          const { page } = result;
          paged = true;
          publish({
            ...empty(online ? "ready" : "offline", page.newer.kind === "end"),
            page,
            edges: state.edges,
            firstInaccessiblePostTime: page.firstInaccessiblePostTime,
          });
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
              edges: state.edges,
              firstInaccessiblePostTime: value?.firstInaccessiblePostTime ?? 0,
            }),
        });
      }
    } catch (error) {
      if (signal.aborted) return;
      const failure = workspaceFailure(error, "network");
      if (failure === "network" || failure === "storage") {
        if (edge) failEdge(edge, historyPageFailure(error, online));
        else if (returnPlace) publish({ ...state, notice: failure });
        else clearPage(failure);
      } else clearPage(failure);
    } finally {
      if (pending === operation) {
        pending = undefined;
        activeEdge = undefined;
      }
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
      if (activeEdge) {
        if (!next) {
          const interrupted = activeEdge;
          pending?.abort();
          pending = undefined;
          activeEdge = undefined;
          failEdge(interrupted, "offline");
          if (changed) void readChanges();
        }
        return;
      }
      if (
        !first &&
        next &&
        !pending &&
        paged &&
        !returnPlace &&
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
      activeEdge = undefined;
    },
    retry() {
      if (activeEdge) return;
      if (!retryChange) return read();
      changed = true;
      return readChanges();
    },
    showLatest() {
      if (state.status !== "positionLost") return;
      target = undefined;
      restored = undefined;
      returnPlace = undefined;
      paged = false;
      publish(empty("loading", true));
      return read();
    },
    async loadEdge(direction: TimelineDirection, postId: string) {
      const boundary = state.page?.[direction];
      if (
        online === undefined ||
        boundary?.kind !== "more" ||
        boundary.postId !== postId ||
        activeEdge
      )
        return;
      await read({ direction, postId });
    },
  };
}
