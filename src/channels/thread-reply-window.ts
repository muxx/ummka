import type { Post } from "../../vendor/mattermost/index.js";
import { channelPostChange } from "../mattermost/channel-post-records.ts";
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

function visibleRow(channelId: string, post: Post & { id: string }): LocalPost {
  const change = channelPostChange(channelId, post.id, post);
  if (change.kind !== "save")
    throw new TypeError("Expected a visible thread post.");
  const { kind: _kind, ...row } = change;
  return row;
}

export function openThreadReplyWindow(
  account: Account,
  scope: Scope,
  focused?: LocalPost,
) {
  const { channelId, rootId, collapsedThreads } = scope;
  if (
    !isMattermostId(channelId) ||
    !isMattermostId(rootId) ||
    typeof collapsedThreads !== "boolean" ||
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
    up: { status: focus ? "ready" : "end" },
    down: { status: "ready" },
  };
  const seen = new Set(focus ? [focus.id] : []);
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
      const page = await account.readThreadPage(
        {
          channelId,
          rootId,
          collapsedThreads,
          direction,
          cursor: cursors[direction],
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
      let replies: LocalPost[];
      if (received.some((row) => seen.has(row.id))) {
        // An imported post's timestamp can change between two page reads.
        const latest = new Map(state.replies.map((row) => [row.id, row]));
        for (const row of received) {
          const prior = latest.get(row.id);
          if (!prior || row.updateAt > prior.updateAt) latest.set(row.id, row);
        }
        replies = [...latest.values()].sort(
          (a, b) =>
            a.createAt - b.createAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
      } else {
        replies =
          direction === "up"
            ? [...received, ...state.replies]
            : [...state.replies, ...received];
      }
      for (const row of received) seen.add(row.id);
      cursors[direction] = page.next ?? undefined;
      finish(direction, {
        ...state,
        root:
          state.root && state.root.updateAt > root.updateAt ? state.root : root,
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
