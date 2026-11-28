import { mutationFailure } from "../mattermost/mutation-error.ts";
import type { openAccountRestConnection } from "../mattermost/native-rest.ts";
import type { openThreadReplyWindow } from "./thread-reply-window.ts";
import { workspaceFailure } from "./workspace-data.ts";

type Account = Pick<
  Awaited<ReturnType<typeof openAccountRestConnection>>,
  "setThreadFollowing" | "readThreadPage"
>;
type Reader = Pick<
  ReturnType<typeof openThreadReplyWindow>,
  "getSnapshot" | "subscribe" | "unavailable"
>;
type State = {
  value?: boolean;
  wanted?: boolean;
  phase: "ready" | "saving" | "checking" | "refused" | "unknown";
};

/** One control belongs to one open, collapsed thread and its authenticated account. */
export function openThreadFollowControl(
  account: Account,
  teamId: string,
  channelId: string,
  rootId: string,
  reader: Reader,
  confirmed: (id: string, following: boolean) => void,
) {
  let state: State = { phase: "ready" };
  let seed = true;
  let running = false;
  let readAfter = false;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const listeners = new Set<() => void>();
  function publish(next: State) {
    state = next;
    for (const listener of listeners) listener();
  }
  function observe() {
    const page = reader.getSnapshot();
    if (page.unavailable) {
      lifetime.abort();
      publish({ phase: "ready" });
    } else if (seed && typeof page.isFollowing === "boolean") {
      // Only seed the control. A reply page cannot undo a confirmed action.
      seed = false;
      publish({ value: page.isFollowing, phase: "ready" });
    } else if (
      seed &&
      state.phase === "ready" &&
      (page.root || page.up.status === "error" || page.down.status === "error")
    ) {
      publish({ phase: "unknown" });
    }
  }
  const unsubscribe = reader.subscribe(observe);
  observe();

  async function request(wanted?: boolean) {
    if (wanted !== undefined) {
      await account.setThreadFollowing(
        teamId,
        { id: rootId, rootId: null },
        wanted,
        signal,
      );
      return wanted;
    }
    const page = await account.readThreadPage(
      {
        channelId,
        rootId,
        collapsedThreads: true,
        direction: "down",
        perPage: 1,
      },
      signal,
    );
    if (signal.aborted) return;
    if (page.kind === "inaccessible") {
      reader.unavailable("limited", page.firstInaccessiblePostTime);
      return;
    }
    if (typeof page.root.isFollowing !== "boolean")
      throw new TypeError("Missing collapsed thread subscription.");
    return page.root.isFollowing;
  }

  async function execute(wanted?: boolean): Promise<void> {
    if (signal.aborted || running) return;
    seed = false;
    running = true;
    const attempted = wanted ?? state.wanted;
    publish({
      value: state.value,
      phase: wanted === undefined ? "checking" : "saving",
      ...(attempted !== undefined && { wanted: attempted }),
    });
    try {
      let following: boolean | undefined;
      try {
        following = await request(wanted);
      } catch (error) {
        if (signal.aborted) return;
        // Read a write refusal before workspaceFailure releases the response body.
        const failure =
          wanted === undefined
            ? null
            : await mutationFailure(error).catch(() => null);
        if (signal.aborted) return;
        let issue = workspaceFailure(error, "network");
        if (wanted !== undefined && issue === "forbidden") {
          try {
            // A write refusal can leave the thread readable. Verify the existing root.
            const actual = await request();
            if (signal.aborted || actual === undefined) return;
            if (failure?.kind === "refused") {
              if (actual !== state.value) confirmed(rootId, actual);
              publish({ value: actual, phase: "refused", wanted });
            } else {
              publish({ value: actual, phase: "ready" });
              confirmed(rootId, actual);
            }
            return;
          } catch (cause) {
            if (signal.aborted) return;
            issue = workspaceFailure(cause, "network");
          }
        }
        if (
          issue === "forbidden" ||
          issue === "session" ||
          issue === "unauthorized"
        )
          reader.unavailable(issue);
        else if (failure?.kind === "refused")
          publish({ value: state.value, phase: "refused", wanted });
        else
          publish({
            phase: "unknown",
            ...(attempted !== undefined && { wanted: attempted }),
          });
        return;
      }
      if (signal.aborted || following === undefined) return;
      publish({ value: following, phase: "ready" });
      confirmed(rootId, following);
    } finally {
      running = false;
      if (readAfter && !signal.aborted) {
        readAfter = false;
        await execute();
      }
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    toggle() {
      if (
        running ||
        (state.phase !== "ready" && state.phase !== "refused") ||
        state.value === undefined
      )
        return Promise.resolve();
      return execute(!state.value);
    },
    check: () => execute(),
    acceptedReply() {
      if (running) {
        readAfter = true;
        return;
      }
      void execute();
    },
    close() {
      lifetime.abort();
      unsubscribe();
      listeners.clear();
    },
  };
}
