import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ResponseError } from "../../vendor/mattermost/index.js";
import type { LocalPost } from "../mattermost/local-history.ts";
import type {
  AccountThreadReads,
  ThreadReadVisit,
} from "../mattermost/thread-read-coordination.ts";
import { inspectPostTarget } from "./inspect-post-target.ts";
import {
  openThreadInbox,
  type ParkedThreadWindow,
  type ThreadInboxPlace,
} from "./thread-inbox.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";

export type ThreadInboxModel = ReturnType<typeof openThreadInbox>;
export type ThreadInboxRow = NonNullable<
  ReturnType<ThreadInboxModel["getSnapshot"]>["page"]["rows"]
>[number];
type Selection = {
  id: string;
  row?: ThreadInboxRow;
  visit?: ThreadReadVisit;
  post: LocalPost | null;
  opening?: boolean;
  confirmedRoot?: LocalPost;
  parked?: ParkedThreadWindow;
  refreshing?: boolean;
  restoreFocus?: boolean;
  issue: ReturnType<typeof workspaceFailure> | "limited" | null;
};
const noSubscription = () => () => {};
const empty = () => null;

export function useWorkspaceThreadInbox(
  connection: WorkspaceConnection,
  threadReads: AccountThreadReads,
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
  const [slowRoot, setSlowRoot] = useState<string>();
  const opening = useRef<AbortController | null>(null);
  const parkCurrent = useRef<(() => void) | null>(null);
  const registerWindow = useCallback((capture: () => void) => {
    parkCurrent.current = capture;
    return () => {
      if (parkCurrent.current === capture) parkCurrent.current = null;
    };
  }, []);
  const currentVisit = useRef<{
    rootId: string;
    visit: ThreadReadVisit;
  } | null>(null);
  const detachVisit = useCallback(() => {
    currentVisit.current?.visit.detach();
    currentVisit.current = null;
  }, []);
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
      connection.subscribeToChannelHistory,
    );
    setModel(next);
    return () => {
      opening.current?.abort();
      detachVisit();
      next.close();
    };
  }, [connection, teamId, enabled, detachVisit]);
  const inbox = enabled ? model : null;
  const state = useSyncExternalStore(
    inbox?.subscribe ?? noSubscription,
    inbox?.getSnapshot ?? empty,
  );
  const denied = selection && inbox?.isRootUnavailable(selection.id);
  const hideRoot = useCallback(
    (id: string, issue: "limited" | "forbidden") => {
      if (currentVisit.current?.rootId === id) {
        currentVisit.current.visit.revoke();
        detachVisit();
      }
      inbox?.revokeRoot(id);
      setSelection((prior) =>
        prior?.id === id ? { ...prior, post: null, issue } : prior,
      );
    },
    [detachVisit, inbox],
  );
  const invalidateChannel = useCallback(
    (channelId: string) => {
      inbox?.discardChannelWindows(channelId);
      if (selection?.post?.channelId === channelId)
        hideRoot(selection.id, "forbidden");
    },
    [inbox, selection?.post?.channelId, selection?.id, hideRoot],
  );
  useLayoutEffect(() => {
    if (!denied) return;
    if (selection?.visit === currentVisit.current?.visit) {
      selection?.visit?.revoke();
      detachVisit();
    }
    opening.current?.abort();
    setSelection((prior) =>
      prior && (!prior.issue || prior.post)
        ? { ...prior, post: null, issue: "forbidden" }
        : prior,
    );
  }, [denied, detachVisit, selection?.visit]);
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
        currentVisit.current?.visit.revoke();
        detachVisit();
        setSelection(null);
        setRestoring(undefined);
      }
    }
  }, [state?.page.status, state?.totals.status, sessionIssue, detachVisit]);
  const closeThread = useCallback(() => {
    parkCurrent.current?.();
    opening.current?.abort();
    detachVisit();
    setSelection(null);
    inbox?.select(null);
  }, [detachVisit, inbox]);
  function close() {
    closeThread();
    setRestoring(undefined);
    inbox?.hide();
    setVisible(false);
    setPaused(false);
  }
  function pause() {
    parkCurrent.current?.();
    opening.current?.abort();
    setPaused(true);
  }
  function resume(post: LocalPost, place: ThreadInboxPlace) {
    if (!inbox || inbox.isRootUnavailable(post.id)) return false;
    if (selection?.id !== post.id) {
      parkCurrent.current?.();
      detachVisit();
    }
    if (!visible || selection?.id !== post.id) {
      previousRestoreRowCount.current = 0;
      setRestoring(place);
      inbox.select(post.id);
      setVisible(true);
      visited.current = true;
      void inbox.show(place.tab);
    }
    // The point read verified the thread. The list may exclude it after it was read.
    const prior = visible && selection?.id === post.id ? selection : null;
    setSelection({
      id: post.id,
      ...(prior && { row: prior.row, visit: prior.visit }),
      post,
      confirmedRoot: post,
      parked: inbox.takeWindow(post.channelId, post.id) ?? prior?.parked,
      restoreFocus: true,
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
    if (selection?.id === row.id && selection.row && !selection.issue) return;
    parkCurrent.current?.();
    opening.current?.abort();
    detachVisit();
    setRestoring(undefined);
    const controller = new AbortController();
    opening.current = controller;
    const { signal } = controller;
    inbox.select(row.id);
    const observeRoot = inbox.beginRootRead();
    const parked =
      inbox.takeWindow(row.post.channelId, row.id) ??
      (selection?.id === row.id ? selection.parked : undefined);
    try {
      const visit = threadReads.visit({
        teamId,
        channelId: row.post.channelId,
        rootId: row.id,
      });
      currentVisit.current = { rootId: row.id, visit };
      setSelection({
        id: row.id,
        row,
        visit,
        post: row.post,
        parked,
        opening: true,
        issue: null,
      });
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
        visit.revoke();
        hideRoot(row.id, found.kind === "archived" ? "limited" : "forbidden");
        return;
      }
      observeRoot(found.post);
      setSelection({
        id: row.id,
        row,
        visit,
        post: row.post,
        confirmedRoot: found.post,
        parked,
        issue: null,
      });
    } catch (error) {
      if (signal.aborted) return;
      const issue = workspaceFailure(error, "network");
      if (issue === "session" || issue === "unauthorized") sessionIssue(issue);
      if (issue === "forbidden") hideRoot(row.id, issue);
      else {
        detachVisit();
        if (parked && (issue === "network" || issue === "storage"))
          setSelection({
            id: row.id,
            row,
            post: row.post,
            parked,
            refreshing: false,
            issue,
          });
        else setSelection({ id: row.id, row, post: null, issue });
      }
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
      selection.opening ||
      !selection.visit ||
      inbox.isRootUnavailable(selection.id) ||
      !connected.current
    )
      throw Error("No active thread to mark");
    try {
      const outcome = await selection.visit.auto(signal);
      if (
        outcome.kind === "confirmed" &&
        !inbox.isRootUnavailable(selection.id)
      )
        await inbox.confirmRead(outcome.mark);
      if (outcome.kind === "unknown") {
        const issue = workspaceFailure(outcome.error, "network");
        if (
          !signal.aborted &&
          (issue === "session" || issue === "unauthorized")
        )
          sessionIssue(issue);
      } else if ("error" in outcome && outcome.error !== undefined) {
        throw outcome.error;
      }
    } catch (error) {
      if (!signal.aborted) {
        const issue = workspaceFailure(error, "network");
        if (issue === "session" || issue === "unauthorized")
          sessionIssue(issue);
        else if (
          error instanceof ResponseError &&
          error.response.status === 403
        )
          hideRoot(selection.id, "forbidden");
      }
      throw error;
    }
  }
  async function checkView(signal: AbortSignal, onRevoked: () => void) {
    const visit = selection?.visit;
    if (
      !inbox ||
      !selection ||
      !visit?.getAutoReview() ||
      inbox.isRootUnavailable(selection.id)
    )
      return;
    const active = () =>
      !signal.aborted && currentVisit.current?.visit === visit;
    try {
      const { following: _following, ...mark } = await visit.observe(signal);
      if (active() && !inbox.isRootUnavailable(selection.id))
        inbox.observeRead(mark);
    } catch (error) {
      if (
        !active() ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      const issue = workspaceFailure(error, "network");
      if (issue === "session" || issue === "unauthorized") sessionIssue(issue);
      // A missing membership also returns 404. Only 403 revokes this panel's access.
      else if (
        error instanceof ResponseError &&
        error.response.status === 403
      ) {
        onRevoked();
        hideRoot(selection.id, "forbidden");
      }
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
  const resumeAccessRead = useEffectEvent(() => {
    if (active?.parked && active.issue === "network" && active.row)
      void choose(active.row);
  });
  useEffect(() => {
    if (online) resumeAccessRead();
  }, [online]);
  const refreshing =
    active?.parked && active.refreshing !== false ? active.id : undefined;
  useEffect(() => {
    if (!refreshing) return;
    const timer = setTimeout(() => setSlowRoot(refreshing), 1_000);
    return () => {
      clearTimeout(timer);
      setSlowRoot(undefined);
    };
  }, [refreshing]);
  const finishOpening = useCallback((id: string) => {
    setSlowRoot(undefined);
    setSelection((prior) =>
      prior?.id === id && prior.parked && prior.refreshing !== false
        ? { ...prior, refreshing: false }
        : prior,
    );
  }, []);
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
    checkView,
    slow: active?.id !== undefined && active.id === slowRoot,
    finishOpening,
    registerWindow,
    confirmFollowing,
    hideRoot,
    invalidateChannel,
  };
}
