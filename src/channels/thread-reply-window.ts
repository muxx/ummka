import type { Post } from "../../vendor/mattermost/index.js";
import type { ChannelPostChange } from "../mattermost/account-channel-events.ts";
import {
  channelPostChange,
  mergePostObservation,
} from "../mattermost/channel-post-records.ts";
import type {
  CardRevision,
  IntegrationCard,
} from "../mattermost/integration-cards.ts";
import type {
  LiveHistoryAccess,
  LocalPost,
} from "../mattermost/local-history.ts";
import { retryPostObservation } from "../mattermost/message-anchors.ts";
import {
  isMattermostId,
  isMattermostTime,
} from "../mattermost/model-fields.ts";
import type { openAccountRestConnection } from "../mattermost/native-rest.ts";
import type { ThreadPageRequest } from "../mattermost/thread-page.ts";
import {
  type HistoryPageFailure,
  historyPageFailure,
  workspaceFailure,
} from "./workspace-data.ts";

type Account = Pick<
  Awaited<ReturnType<typeof openAccountRestConnection>>,
  "readThreadPage"
>;
type Scope = Pick<
  ThreadPageRequest,
  "channelId" | "rootId" | "collapsedThreads"
>;
type Direction = ThreadPageRequest["direction"];
type Cursor = NonNullable<ThreadPageRequest["cursor"]>;
type Edge =
  | { status: "ready" | "end" | "loading" }
  | { status: "error"; error: unknown; reason: HistoryPageFailure };

interface ReplyWindow {
  isFollowing?: boolean;
  unavailable?: "forbidden" | "unauthorized" | "session" | "limited";
  firstInaccessiblePostTime?: number;
  newReplyId?: string;
  root: LocalPost | null;
  replies: readonly LocalPost[];
  up: Edge;
  down: Edge;
}

type RetainedEdge = {
  status: "ready" | "end";
  cursor?: Cursor;
};
export type RetainedThreadReplies = {
  root: LocalPost;
  replies: readonly LocalPost[];
  isFollowing?: boolean;
  up: RetainedEdge;
  down: RetainedEdge;
  cardRevisions: ReadonlyMap<string, CardRevision>;
};
const retainedReplyLimit = 120;
const cursorFor = ({ id, createAt }: LocalPost): Cursor => ({ id, createAt });

type ThreadPost = Post & {
  id: string;
  cards?: readonly IntegrationCard[];
  cardRevision?: CardRevision;
};

function visibleRow(
  channelId: string,
  post: ThreadPost,
  collapsedThreads = false,
) {
  const change = channelPostChange(channelId, post.id, post, {
    cardObservation: post,
    collapsedThreads,
  });
  if (change.kind !== "save")
    throw new TypeError("Expected a visible thread post.");
  const { kind: _kind, ...row } = change;
  return { ...row, cardRevision: post.cardRevision };
}

function compareReplies(
  a: Pick<LocalPost, "id" | "createAt">,
  b: Pick<LocalPost, "id" | "createAt">,
) {
  return a.createAt - b.createAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function openThreadReplyWindow(
  account: Account,
  scope: Scope,
  start?: LocalPost | { lastViewedAt: number; userId: string },
  initialRoot?: LocalPost,
  retained?: RetainedThreadReplies,
) {
  const { channelId, rootId, collapsedThreads } = scope;
  const unread = start && "lastViewedAt" in start ? { ...start } : undefined;
  const focused = start && "id" in start ? start : undefined;
  if (
    !isMattermostId(channelId) ||
    !isMattermostId(rootId) ||
    typeof collapsedThreads !== "boolean" ||
    (retained &&
      (retained.root.id !== rootId || retained.root.channelId !== channelId)) ||
    (unread &&
      (!isMattermostTime(unread.lastViewedAt, 0) ||
        !isMattermostId(unread.userId))) ||
    (focused &&
      (focused.channelId !== channelId ||
        focused.rootId !== rootId ||
        !isMattermostId(focused.id) ||
        focused.id === rootId ||
        !isMattermostTime(focused.createAt, 1)))
  ) {
    throw new TypeError("Invalid Mattermost thread window.");
  }
  const focus = focused && { ...focused };
  const anchor = focus && { id: focus.id, createAt: focus.createAt };
  const time = unread?.lastViewedAt;
  // A strict upper query from t + 1 includes every reply at t. Zero is the
  // server's unbounded-time sentinel; never send an imprecise maximum + 1.
  const initialTime = {
    up:
      time !== undefined && time < Number.MAX_SAFE_INTEGER
        ? time + 1
        : undefined,
    down: time || undefined,
  };
  const cursors: Record<Direction, ThreadPageRequest["cursor"]> = {
    up: retained?.up.cursor ?? anchor,
    down: retained?.replies.length
      ? cursorFor(retained.replies[retained.replies.length - 1])
      : (retained?.down.cursor ?? anchor),
  };
  const requests: Partial<Record<Direction, Promise<void>>> = {};
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  let opened: Promise<void> | undefined;
  let readReplies = false;
  let state: ReplyWindow = {
    root: retained?.root ?? initialRoot ?? null,
    replies: retained?.replies ?? (focus ? [focus] : []),
    up: {
      status:
        retained?.up.status ??
        (focus || (time !== undefined && time > 0) ? "ready" : "end"),
    },
    down: {
      status:
        retained?.down.status ??
        (time === Number.MAX_SAFE_INTEGER ? "end" : "ready"),
    },
    ...(retained && { isFollowing: retained.isFollowing }),
  };
  const seen = new Set(state.replies.map(({ id }) => id));
  let observation = 0;
  const priorityByPost = new Map<string, number>();
  const cardsByPost = new Map(retained?.cardRevisions);
  const deleted = new Set<string>();
  let cutoff = 0;
  const canShow = (post: Pick<LocalPost, "id" | "createAt">) =>
    post.createAt > cutoff && !deleted.has(post.id);
  function publish(next: ReplyWindow) {
    state = next;
    for (const listener of listeners) listener();
  }
  function finish(direction: Direction, next: ReplyWindow) {
    delete requests[direction];
    publish(next);
  }
  function stop(
    unavailable?: ReplyWindow["unavailable"],
    firstInaccessiblePostTime?: number,
  ) {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    seen.clear();
    priorityByPost.clear();
    cardsByPost.clear();
    deleted.clear();
    publish({
      unavailable,
      ...(firstInaccessiblePostTime && { firstInaccessiblePostTime }),
      root: null,
      replies: [],
      up: { status: "end" },
      down: { status: "end" },
    });
    listeners.clear();
  }
  function merge(
    prior: LocalPost | null | undefined,
    { cardRevision, ...row }: ReturnType<typeof visibleRow>,
    equal: "keep" | "refresh",
    stamp: number,
  ) {
    const allowEqualPriority = (priorityByPost.get(row.id) ?? 0) < stamp;
    if (
      row.displayPriority !== undefined &&
      (!prior ||
        row.updateAt > prior.updateAt ||
        (row.updateAt === prior.updateAt && allowEqualPriority))
    )
      priorityByPost.set(row.id, stamp);
    const merged = mergePostObservation(prior, row, equal, allowEqualPriority);
    const previousRevision = cardsByPost.get(row.id);
    const accepted =
      cardRevision &&
      (!previousRevision ||
        cardRevision.updateAt > previousRevision.updateAt ||
        (cardRevision.updateAt === previousRevision.updateAt &&
          cardRevision.dispatch > previousRevision.dispatch));
    if (accepted) cardsByPost.set(row.id, cardRevision);
    const cards = accepted ? row.cards : prior?.cards;
    return merged.cards === cards ? merged : { ...merged, cards };
  }
  async function read(direction: Direction, quietly: boolean) {
    try {
      const { signal } = lifetime;
      signal.throwIfAborted();
      // Full observations of the same post version are ordered by dispatch, not completion.
      const stamp = ++observation;
      const page = await account.readThreadPage(
        {
          channelId,
          rootId,
          collapsedThreads,
          direction,
          ...(cursors[direction] || initialTime[direction] === undefined
            ? { cursor: cursors[direction] }
            : { fromCreateAt: initialTime[direction] }),
        },
        signal,
      );
      if (signal.aborted) return;
      if (page.kind === "inaccessible") {
        // getPostThread omits all posts when the thread is outside the history limit.
        stop("limited", page.firstInaccessiblePostTime);
        return;
      }
      const root = visibleRow(channelId, page.root, collapsedThreads);
      if (!canShow(root)) {
        stop("limited", cutoff);
        return;
      }
      const received = page.replies
        .filter(canShow)
        .map((post) => visibleRow(channelId, post));
      if (direction === "up") received.reverse();
      const newReply =
        quietly && retained?.down.status === "end"
          ? received.find(({ id }) => !seen.has(id))
          : undefined;
      let replies: LocalPost[];
      if (received.some((row) => seen.has(row.id))) {
        // An imported post's timestamp can change between two page reads.
        const latest = new Map(state.replies.map((row) => [row.id, row]));
        for (const row of received) {
          latest.set(row.id, merge(latest.get(row.id), row, "keep", stamp));
        }
        replies = [...latest.values()].sort(compareReplies);
      } else {
        const appended = received.map((row) => merge(null, row, "keep", stamp));
        replies =
          direction === "up"
            ? [...appended, ...state.replies]
            : [...state.replies, ...appended];
      }
      for (const row of received) seen.add(row.id);
      readReplies = true;
      cursors[direction] = page.next ?? undefined;
      finish(direction, {
        ...state,
        ...(newReply && { newReplyId: newReply.id }),
        isFollowing: page.root.isFollowing,
        root: merge(state.root, root, "refresh", stamp),
        replies,
        [direction]: { status: page.next ? "ready" : "end" },
      });
    } catch (error) {
      if (lifetime.signal.aborted) return;
      const failure = workspaceFailure(error, "network");
      if (
        failure === "forbidden" ||
        failure === "unauthorized" ||
        failure === "session"
      ) {
        stop(failure);
        return;
      }
      if (quietly) {
        delete requests[direction];
        opened = undefined;
        return;
      }
      finish(direction, {
        ...state,
        [direction]: {
          status: "error",
          error,
          reason: historyPageFailure(error, navigator.onLine),
        },
      });
    }
  }
  function load(direction: Direction, status: Edge["status"], quietly = false) {
    if (lifetime.signal.aborted) return Promise.resolve();
    if (requests[direction]) return requests[direction];
    if (state[direction].status !== status) return Promise.resolve();
    const pending = Promise.resolve().then(() => read(direction, quietly));
    requests[direction] = pending;
    if (!quietly) publish({ ...state, [direction]: { status: "loading" } });
    return pending;
  }
  async function refreshEvents(
    reconcile: boolean,
    addresses: readonly ChannelPostChange[],
    changes: readonly ReturnType<typeof channelPostChange>[],
    attempt: AbortSignal,
    firstVisible?: string,
  ) {
    attempt.throwIfAborted();
    if (lifetime.signal.aborted) return;
    const relevant = addresses.filter(
      (row) =>
        row.channelId === channelId &&
        (row.postId === rootId || row.rootId === rootId),
    );
    if (
      relevant.some((row) => row.postId === rootId && row.kind === "deleted")
    ) {
      stop("forbidden");
      return;
    }
    const changed = new Map(changes.map((row) => [row.id, row]));
    for (const row of relevant)
      if (row.kind === "deleted") deleted.add(row.postId);
    const updated = (row: LocalPost) => {
      const change = changed.get(row.id);
      return change?.kind === "save" &&
        change.channelId === channelId &&
        change.rootId === row.rootId &&
        change.updateAt > row.updateAt
        ? { ...row, ...change }
        : row;
    };
    const replies = state.replies
      .filter((row) => !deleted.has(row.id))
      .map(updated);
    if (changed.size)
      publish({ ...state, root: state.root && updated(state.root), replies });
    if (!reconcile && !relevant.some((row) => row.kind === "created")) return;
    // Preserve the open reply boundary. A reader before a gap reaches new replies
    // through the existing forward page control.
    if (requests.down) await requests.down;
    attempt.throwIfAborted();
    if (lifetime.signal.aborted || (!reconcile && state.down.status !== "end"))
      return;
    const signal = AbortSignal.any([attempt, lifetime.signal]);
    const prior = state.replies;
    const first = prior.findIndex((row) => row.id === firstVisible);
    const cursor = reconcile
      ? first > 0
        ? prior[first - 1]
        : state.up.status === "end"
          ? undefined
          : prior[0]
      : undefined;
    const stamp = ++observation;
    let page: Awaited<ReturnType<Account["readThreadPage"]>>;
    try {
      page = await retryPostObservation(
        () =>
          account.readThreadPage(
            {
              ...scope,
              direction: reconcile ? "down" : "up",
              cursor: cursor && { id: cursor.id, createAt: cursor.createAt },
            },
            signal,
          ),
        signal,
      );
    } catch (error) {
      attempt.throwIfAborted();
      if (lifetime.signal.aborted) return;
      const failure = workspaceFailure(error, "network");
      if (
        failure === "forbidden" ||
        failure === "session" ||
        failure === "unauthorized"
      )
        stop(failure);
      if (failure === "forbidden") return;
      throw error;
    }
    attempt.throwIfAborted();
    if (lifetime.signal.aborted) return;
    if (page.kind === "inaccessible") {
      stop("limited", page.firstInaccessiblePostTime);
      return;
    }
    const root = visibleRow(channelId, page.root, collapsedThreads);
    if (!canShow(root)) {
      stop("limited", cutoff);
      return;
    }
    const received = page.replies
      .filter(canShow)
      .map((row) => visibleRow(channelId, row));
    const last = prior.at(-1);
    const newestRoot = merge(state.root, root, "refresh", stamp);
    if (
      !reconcile &&
      page.next &&
      last &&
      !received.some((row) => seen.has(row.id))
    ) {
      // No overlap between the fresh end and the previous end. Leave the gap
      // on the existing forward control; the unread tail is not contiguous.
      cursors.down = { id: last.id, createAt: last.createAt };
      publish({ ...state, root: newestRoot, down: { status: "ready" } });
      return;
    }
    const merged = new Map(state.replies.map((row) => [row.id, row]));
    if (reconcile) {
      const returned = new Set(received.map((row) => row.id));
      for (const row of prior) {
        if (
          (!cursor || compareReplies(row, cursor) > 0) &&
          (!page.next || compareReplies(row, page.next) <= 0) &&
          !returned.has(row.id)
        ) {
          merged.delete(row.id);
          seen.delete(row.id);
        }
      }
    }
    const newReply = !reconcile && received.find(({ id }) => !seen.has(id));
    for (const row of received) {
      merged.set(row.id, merge(merged.get(row.id), row, "keep", stamp));
      seen.add(row.id);
    }
    const rows = [...merged.values()].sort(compareReplies);
    // An interior reconciliation page cannot replace the cursor of a separately
    // loaded later page.
    const extendsEnd =
      !reconcile || !last || !page.next || compareReplies(page.next, last) >= 0;
    if (extendsEnd)
      cursors.down = reconcile ? (page.next ?? undefined) : undefined;
    if (!reconcile && !prior.length) cursors.up = page.next ?? undefined;
    publish({
      ...state,
      root: newestRoot,
      replies: rows,
      ...(newReply && { newReplyId: newReply.id }),
      up:
        !reconcile && !prior.length
          ? { status: page.next ? "ready" : "end" }
          : state.up,
      down: extendsEnd
        ? { status: reconcile && page.next ? "ready" : "end" }
        : state.down,
    });
  }
  return {
    channelId,
    rootId,
    refreshEvents,
    restrictHistory(access: LiveHistoryAccess, rootCreatedAt?: number) {
      if (lifetime.signal.aborted) return;
      if (access.kind === "cutoff") {
        if (access.time <= cutoff) return;
        cutoff = access.time;
        const stamp = state.root?.createAt ?? rootCreatedAt;
        if (stamp !== undefined && stamp <= cutoff) {
          stop("limited", cutoff);
          return;
        }
      } else {
        if (access.postId === rootId) {
          stop("forbidden");
          return;
        }
        deleted.add(access.postId);
      }
      const replies = state.replies.filter(canShow);
      if (access.kind === "cutoff" || replies.length !== state.replies.length)
        publish({ ...state, replies, firstInaccessiblePostTime: cutoff });
    },
    getSnapshot: () => state,
    hasReadPage: () => readReplies,
    confirmRoot(root: LocalPost) {
      if (
        lifetime.signal.aborted ||
        root.id !== rootId ||
        root.channelId !== channelId ||
        root.rootId !== null
      )
        return;
      const projected = mergePostObservation(state.root, root, "refresh");
      if (projected !== state.root) publish({ ...state, root: projected });
    },
    retain(place?: {
      id?: string;
      atEnd?: boolean;
    }): RetainedThreadReplies | null {
      if (
        lifetime.signal.aborted ||
        state.unavailable ||
        !state.root ||
        (!retained && !readReplies)
      )
        return null;
      const { root, replies, isFollowing } = state;
      const index = place?.atEnd
        ? replies.length - 1
        : replies.findIndex((row) => row.id === place?.id);
      const start = Math.max(
        0,
        Math.min(
          index - retainedReplyLimit / 2,
          replies.length - retainedReplyLimit,
        ),
      );
      const end = start + retainedReplyLimit;
      const kept = replies.slice(start, end);
      const cardRevisions = new Map<string, CardRevision>();
      for (const { id } of [root, ...kept]) {
        const revision = cardsByPost.get(id);
        if (revision) cardRevisions.set(id, revision);
      }
      return {
        root,
        replies: kept,
        isFollowing,
        up:
          start > 0
            ? { status: "ready", cursor: cursorFor(kept[0]) }
            : {
                status: state.up.status === "end" ? "end" : "ready",
                cursor: cursors.up,
              },
        down:
          end < replies.length
            ? { status: "ready", cursor: cursorFor(kept[kept.length - 1]) }
            : {
                status: state.down.status === "end" ? "end" : "ready",
                cursor: cursors.down,
              },
        cardRevisions,
      };
    },
    getUnreadPosition(boundary = unread) {
      if (!boundary || lifetime.signal.aborted) return null;
      const first = state.replies.find(
        (row) =>
          row.createAt > boundary.lastViewedAt &&
          row.userId !== boundary.userId,
      );
      if (first) return { kind: "found" as const, postId: first.id };
      return state.down.status === "end"
        ? { kind: "none" as const }
        : { kind: "pending" as const };
    },
    subscribe(listener: () => void) {
      if (!lifetime.signal.aborted) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    unavailable: (
      reason: NonNullable<ReplyWindow["unavailable"]>,
      time?: number,
    ) => stop(reason, time),
    open() {
      opened ??= retained
        ? load("down", state.down.status, true)
        : Promise.all([load("up", "ready"), load("down", "ready")]).then(
            () => {},
          );
      return opened;
    },
    more: (direction: Direction) => load(direction, "ready"),
    retry: (direction: Direction) => load(direction, "error"),
    close() {
      stop();
    },
  };
}
