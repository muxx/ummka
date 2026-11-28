import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { LocalPost } from "../mattermost/local-history.ts";
import { inspectPostTarget } from "./inspect-post-target.ts";
import { openThreadInbox, type ThreadInboxPlace } from "./thread-inbox.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";

export type ThreadInboxModel = ReturnType<typeof openThreadInbox>;
export type ThreadInboxRow = NonNullable<
  ReturnType<ThreadInboxModel["getSnapshot"]>["page"]["rows"]
>[number];
type Selection = {
  id: string;
  row?: ThreadInboxRow;
  post: LocalPost | null;
  issue: ReturnType<typeof workspaceFailure> | "limited" | null;
};
const noSubscription = () => () => {};
const empty = () => null;

export function useWorkspaceThreadInbox(
  connection: WorkspaceConnection,
  teamId: string,
  enabled: boolean,
  online: boolean,
  sessionIssue: (issue: "session" | "unauthorized") => void,
) {
  const [model, setModel] = useState<ThreadInboxModel | null>(null);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [restoring, setRestoring] = useState<ThreadInboxPlace>();
  const previousRestoreRowCount = useRef(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const opening = useRef<AbortController | null>(null);
  const visited = useRef(false);
  const connected = useRef(online);
  useLayoutEffect(() => {
    connected.current = online;
  }, [online]);
  useLayoutEffect(() => {
    setVisible(false);
    setPaused(false);
    setRestoring(undefined);
    setSelection(null);
    visited.current = false;
    if (!enabled) {
      setModel(null);
      return;
    }
    const checkOnline = () => {
      if (!connected.current) throw Error("Offline");
    };
    const next = openThreadInbox(
      {
        readFollowedThreads(query, signal) {
          checkOnline();
          return connection.readFollowedThreads(query, signal);
        },
        readFollowedThreadTotals(team, signal) {
          checkOnline();
          return connection.readFollowedThreadTotals(team, signal);
        },
      },
      teamId,
    );
    setModel(next);
    return () => {
      opening.current?.abort();
      next.close();
    };
  }, [connection, teamId, enabled]);
  const inbox = enabled ? model : null;
  const state = useSyncExternalStore(
    inbox?.subscribe ?? noSubscription,
    inbox?.getSnapshot ?? empty,
  );
  const denied = selection && inbox?.isRootUnavailable(selection.id);
  const hideRoot = useCallback(
    (id: string, issue: "limited" | "forbidden") => {
      inbox?.revokeRoot(id);
      setSelection((prior) =>
        prior?.id === id ? { ...prior, post: null, issue } : prior,
      );
    },
    [inbox],
  );
  useLayoutEffect(() => {
    if (!denied) return;
    opening.current?.abort();
    setSelection((prior) =>
      prior && (!prior.issue || prior.post)
        ? { ...prior, post: null, issue: "forbidden" }
        : prior,
    );
  }, [denied]);
  useEffect(() => {
    if (online && inbox) void inbox.refreshTotals();
  }, [online, inbox]);
  useEffect(() => {
    for (const status of [state?.page.status, state?.totals.status]) {
      if (status === "session" || status === "unauthorized") {
        sessionIssue(status);
        return;
      }
      if (status === "forbidden") {
        opening.current?.abort();
        setSelection(null);
        setRestoring(undefined);
      }
    }
  }, [state?.page.status, state?.totals.status, sessionIssue]);
  const closeThread = useCallback(() => {
    opening.current?.abort();
    setSelection(null);
    inbox?.select(null);
  }, [inbox]);
  function close() {
    closeThread();
    setRestoring(undefined);
    inbox?.hide();
    setVisible(false);
    setPaused(false);
  }
  function pause() {
    opening.current?.abort();
    setPaused(true);
  }
  function resume(post: LocalPost, place: ThreadInboxPlace) {
    if (!inbox || inbox.isRootUnavailable(post.id)) return false;
    if (!visible || selection?.id !== post.id) {
      previousRestoreRowCount.current = 0;
      setRestoring(place);
      inbox.select(post.id);
      setVisible(true);
      visited.current = true;
      void inbox.show(place.tab);
    }
    // The point read verified the thread. The list may exclude it after it was read.
    setSelection({
      id: post.id,
      ...(visible && selection?.id === post.id && { row: selection.row }),
      post,
      issue: null,
    });
    setPaused(false);
    return true;
  }
  useEffect(() => {
    if (!restoring || !inbox || !state) return;
    const { tab, page } = state;
    if (tab === restoring.tab) {
      if (page.status === "idle" || page.status === "loading") return;
      const rowCount = page.rows?.length ?? 0;
      if (
        page.status === "ready" &&
        page.nextBefore &&
        rowCount < restoring.restoreRowLimit &&
        rowCount > previousRestoreRowCount.current &&
        !page.rows?.some((row) => row.id === restoring.id)
      ) {
        previousRestoreRowCount.current = rowCount;
        void inbox.loadMore();
        return;
      }
    }
    setRestoring(undefined);
  }, [inbox, restoring, state]);
  function show() {
    if (!inbox || (visible && !paused)) return;
    if (paused) {
      closeThread();
      setRestoring(undefined);
      inbox.hide();
      setPaused(false);
    }
    setVisible(true);
    if (visited.current) void inbox.refreshTotals();
    void inbox.show(inbox.getSnapshot().tab);
    visited.current = true;
  }
  async function choose(row: ThreadInboxRow) {
    if (!inbox || !row.post || inbox.isRootUnavailable(row.id)) return;
    opening.current?.abort();
    setRestoring(undefined);
    const controller = new AbortController();
    opening.current = controller;
    const { signal } = controller;
    inbox.select(row.id);
    const observeRoot = inbox.beginRootRead();
    setSelection({ id: row.id, row, post: null, issue: null });
    try {
      if (!connected.current) throw Error("Offline");
      const found = await inspectPostTarget(
        connection,
        { kind: "post", id: row.id },
        teamId,
        signal,
      );
      if (signal.aborted || inbox.isRootUnavailable(row.id)) return;
      if (
        found.kind !== "ready" ||
        found.teamId !== teamId ||
        found.post.id !== row.id ||
        found.post.channelId !== row.post.channelId ||
        found.post.rootId !== null
      ) {
        hideRoot(row.id, found.kind === "archived" ? "limited" : "forbidden");
        return;
      }
      observeRoot(found.post);
      setSelection({ id: row.id, row, post: found.post, issue: null });
    } catch (error) {
      if (signal.aborted) return;
      const issue = workspaceFailure(error, "network");
      if (issue === "session" || issue === "unauthorized") sessionIssue(issue);
      if (issue === "forbidden") hideRoot(row.id, issue);
      else setSelection({ id: row.id, row, post: null, issue });
    }
  }
  const confirmFollowing = useCallback(
    (id: string, following: boolean) => {
      if (following) void inbox?.confirmFollow();
      else void inbox?.confirmUnfollow(id);
    },
    [inbox],
  );
  async function confirmView(signal: AbortSignal) {
    if (
      !inbox ||
      !selection?.post ||
      inbox.isRootUnavailable(selection.id) ||
      !connected.current
    )
      throw Error("No active thread to mark");
    try {
      const mark = await connection.markFollowedThreadRead(
        teamId,
        selection.id,
        Date.now(),
        signal,
      );
      signal.throwIfAborted();
      await inbox.confirmRead(mark);
    } catch (error) {
      if (!signal.aborted) {
        const issue = workspaceFailure(error, "network");
        if (issue === "session" || issue === "unauthorized")
          sessionIssue(issue);
      }
      throw error;
    }
  }
  const accessDenied = [state?.page.status, state?.totals.status].some(
    (status) =>
      status === "forbidden" ||
      status === "unauthorized" ||
      status === "session",
  );
  const active =
    inbox && visible && !paused && !accessDenied ? selection : null;
  return {
    model: inbox,
    state,
    visible: Boolean(inbox && visible && !paused),
    paused: Boolean(inbox && visible && paused),
    selectedId: (paused ? selection : active)?.id,
    restoring: Boolean(restoring),
    selection:
      active && denied
        ? {
            ...active,
            post: null,
            issue: active.issue ?? ("forbidden" as const),
          }
        : active,
    closeThread,
    close,
    show,
    pause,
    resume,
    choose,
    confirmView,
    confirmFollowing,
    hideRoot,
  };
}
