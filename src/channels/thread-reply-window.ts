import type { Post } from "../../vendor/mattermost/index.js";
import {
  channelPostChange,
  mergePostObservation,
} from "../mattermost/channel-post-records.ts";
import type {
  CardRevision,
  IntegrationCard,
} from "../mattermost/integration-cards.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import {
  isMattermostId,
  isMattermostTime,
} from "../mattermost/model-fields.ts";
import type { openAccountRestConnection } from "../mattermost/native-rest.ts";
import type { ThreadPageRequest } from "../mattermost/thread-page.ts";
import { workspaceFailure } from "./workspace-data.ts";

type Account = Pick<
  Awaited<ReturnType<typeof openAccountRestConnection>>,
  "readThreadPage"
>;
type Scope = Pick<
  ThreadPageRequest,
  "channelId" | "rootId" | "collapsedThreads"
>;
type Direction = ThreadPageRequest["direction"];
type Edge =
  | { status: "ready" | "end" | "loading" }
  | { status: "error"; error: unknown };

interface ReplyWindow {
  unavailable?: "forbidden" | "unauthorized" | "session" | "limited";
  firstInaccessiblePostTime?: number;
  root: LocalPost | null;
  replies: readonly LocalPost[];
  up: Edge;
  down: Edge;
}

type ThreadPost = Post & {
  id: string;
  cards?: readonly IntegrationCard[];
  cardRevision?: CardRevision;
};

function visibleRow(channelId: string, post: ThreadPost) {
  const change = channelPostChange(channelId, post.id, post, {
    cardObservation: post,
  });
  if (change.kind !== "save")
    throw new TypeError("Expected a visible thread post.");
  const { kind: _kind, ...row } = change;
  return { ...row, cardRevision: post.cardRevision };
}

export function openThreadReplyWindow(
  account: Account,
  scope: Scope,
  start?: LocalPost | { lastViewedAt: number; userId: string },
) {
  const { channelId, rootId, collapsedThreads } = scope;
  const unread = start && "lastViewedAt" in start ? { ...start } : undefined;
  const focused = start && "id" in start ? start : undefined;
  if (
    !isMattermostId(channelId) ||
    !isMattermostId(rootId) ||
    typeof collapsedThreads !== "boolean" ||
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
    up: anchor,
    down: anchor,
  };
  const requests: Partial<Record<Direction, Promise<void>>> = {};
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  let opened: Promise<void> | undefined;
  let state: ReplyWindow = {
    root: null,
    replies: focus ? [focus] : [],
    up: { status: focus || (time !== undefined && time > 0) ? "ready" : "end" },
    down: { status: time === Number.MAX_SAFE_INTEGER ? "end" : "ready" },
  };
  const seen = new Set(focus ? [focus.id] : []);
  let observation = 0;
  const priorityByPost = new Map<string, number>();
  const cardsByPost = new Map<string, CardRevision>();
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
  async function read(direction: Direction) {
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
      const root = visibleRow(channelId, page.root);
      const received = page.replies.map((post) => visibleRow(channelId, post));
      if (direction === "up") received.reverse();
      function merge(
        prior: LocalPost | null | undefined,
        { cardRevision, ...row }: ReturnType<typeof visibleRow>,
        equal: "keep" | "refresh",
      ) {
        const allowEqualPriority = (priorityByPost.get(row.id) ?? 0) < stamp;
        if (
          row.displayPriority !== undefined &&
          (!prior ||
            row.updateAt > prior.updateAt ||
            (row.updateAt === prior.updateAt && allowEqualPriority))
        )
          priorityByPost.set(row.id, stamp);
        const merged = mergePostObservation(
          prior,
          row,
          equal,
          allowEqualPriority,
        );
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
      let replies: LocalPost[];
      if (received.some((row) => seen.has(row.id))) {
        // An imported post's timestamp can change between two page reads.
        const latest = new Map(state.replies.map((row) => [row.id, row]));
        for (const row of received) {
          latest.set(row.id, merge(latest.get(row.id), row, "keep"));
        }
        replies = [...latest.values()].sort(
          (a, b) =>
            a.createAt - b.createAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
      } else {
        const appended = received.map((row) => merge(null, row, "keep"));
        replies =
          direction === "up"
            ? [...appended, ...state.replies]
            : [...state.replies, ...appended];
      }
      for (const row of received) seen.add(row.id);
      cursors[direction] = page.next ?? undefined;
      finish(direction, {
        ...state,
        root: merge(state.root, root, "refresh"),
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
      finish(direction, {
        ...state,
        [direction]: { status: "error", error },
      });
    }
  }
  function load(direction: Direction, status: "ready" | "error") {
    if (lifetime.signal.aborted) return Promise.resolve();
    if (requests[direction]) return requests[direction];
    if (state[direction].status !== status) return Promise.resolve();
    const pending = Promise.resolve().then(() => read(direction));
    requests[direction] = pending;
    publish({ ...state, [direction]: { status: "loading" } });
    return pending;
  }
  return {
    getSnapshot: () => state,
    getUnreadPosition() {
      if (!unread || lifetime.signal.aborted) return null;
      const first = state.replies.find(
        (row) =>
          row.createAt > unread.lastViewedAt && row.userId !== unread.userId,
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
    open() {
      opened ??= Promise.all([load("up", "ready"), load("down", "ready")]).then(
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
