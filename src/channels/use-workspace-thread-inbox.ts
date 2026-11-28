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
  post?: LocalPost | null;
  opening?: boolean;
  confirmedRoot?: LocalPost;
  parked?: ParkedThreadWindow;
  refreshing?: boolean;
  restoreFocus?: boolean;
  retainedAccessRevoked?: boolean;
  issue: ReturnType<typeof workspaceFailure> | "limited" | null;
};
type Denial = "limited" | "forbidden";
type Opening = { id: string; channelId: string; controller: AbortController };
function deniedSelection(selection: Selection, issue: Denial): Selection {
  return {
    id: selection.id,
    issue,
    ...(selection.parked || selection.retainedAccessRevoked
      ? { retainedAccessRevoked: true }
      : {}),
  };
}

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
  const opening = useRef<Opening>(null);
  const parkCurrent = useRef<{ id: string; capture: () => void }>(null);
  const registerWindow = useCallback((id: string, capture: () => void) => {
    const registration = { id, capture };
    parkCurrent.current = registration;
    return () => {
      if (parkCurrent.current === registration) parkCurrent.current = null;
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
      opening.current?.controller.abort();
      opening.current = null;
      parkCurrent.current = null;
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
  const discardSelection = useCallback(
    (id?: string) => {
      if (opening.current && (id === undefined || opening.current.id === id)) {
        opening.current.controller.abort();
        opening.current = null;
      }
      if (id === undefined || parkCurrent.current?.id === id)
        parkCurrent.current = null;
      if (id === undefined || currentVisit.current?.rootId === id) {
        currentVisit.current?.visit.revoke();
        detachVisit();
      }
    },
    [detachVisit],
  );
  const hideRoot = useCallback(
    (id: string, issue: Denial) => {
      discardSelection(id);
      inbox?.revokeRoot(id);
      setSelection((prior) =>
        prior?.id === id ? deniedSelection(prior, issue) : prior,
      );
    },
    [discardSelection, inbox],
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
    if (
      !denied ||
      selection?.issue === "forbidden" ||
      selection?.issue === "limited"
    )
      return;
    const id = selection?.id;
    if (!id) return;
    discardSelection(id);
    setSelection((prior) =>
      prior?.id === id ? deniedSelection(prior, "forbidden") : prior,
    );
  }, [denied, discardSelection, selection?.id, selection?.issue]);
  const accessDenied = [state?.page.status, state?.totals.status].some(
    (status) =>
      status === "forbidden" ||
      status === "unauthorized" ||
      status === "session",
  );
  useLayoutEffect(() => {
    if (!accessDenied) return;
    discardSelection();
    inbox?.select(null);
    setSelection(null);
    setRestoring(undefined);
  }, [accessDenied, discardSelection, inbox]);
  useEffect(() => {
    if (online && inbox) void inbox.refreshTotals();
  }, [online, inbox]);
  useEffect(() => {
    for (const status of [state?.page.status, state?.totals.status]) {
      if (status === "session" || status === "unauthorized") {
        sessionIssue(status);
        return;
      }
    }
  }, [state?.page.status, state?.totals.status, sessionIssue]);
  const closeThread = useCallback(() => {
    parkCurrent.current?.capture();
    parkCurrent.current = null;
    opening.current?.controller.abort();
    opening.current = null;
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
    parkCurrent.current?.capture();
    parkCurrent.current = null;
    opening.current?.controller.abort();
    opening.current = null;
    setPaused(true);
  }
  function resume(post: LocalPost, place: ThreadInboxPlace) {
    if (!inbox || inbox.isRootUnavailable(post.id)) return false;
    if (selection?.id !== post.id) {
      parkCurrent.current?.capture();
      parkCurrent.current = null;
      opening.current?.controller.abort();
      opening.current = null;
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
  const readRoot = useCallback(
    async (request: Opening) => {
      if (!inbox) return;
      const {
        id,
        channelId,
        controller: { signal },
      } = request;
      const observeRoot = inbox.beginRootRead();
      try {
        const visit = threadReads.visit({ teamId, channelId, rootId: id });
        currentVisit.current = { rootId: id, visit };
        setSelection((prior) =>
          prior?.id === id ? { ...prior, visit } : prior,
        );
        if (!connected.current) throw Error("Offline");
        const found = await inspectPostTarget(
          connection,
          { kind: "post", id },
          teamId,
          signal,
        );
        if (signal.aborted || inbox.isRootUnavailable(id)) return;
        if (
          found.kind !== "ready" ||
          found.teamId !== teamId ||
          found.post.id !== id ||
          found.post.channelId !== channelId ||
          found.post.rootId !== null
        ) {
          hideRoot(id, found.kind === "archived" ? "limited" : "forbidden");
          return;
        }
        observeRoot(found.post);
        setSelection((prior) =>
          prior?.id === id && prior.opening
            ? { ...prior, opening: false, confirmedRoot: found.post }
            : prior,
        );
      } catch (error) {
        if (signal.aborted) return;
        const issue = workspaceFailure(error, "network");
        if (issue === "session" || issue === "unauthorized") {
          discardSelection(id);
          setSelection((prior) => (prior?.id === id ? null : prior));
          sessionIssue(issue);
        } else if (issue === "forbidden") hideRoot(id, issue);
        else {
          detachVisit();
          setSelection((prior) => {
            if (prior?.id !== id || !prior.opening) return prior;
            const { row, post, parked } = prior;
            return parked
              ? { id, row, post, parked, refreshing: false, issue }
              : { id, row, issue };
          });
        }
      } finally {
        if (opening.current === request) opening.current = null;
      }
    },
    [
      inbox,
      threadReads,
      teamId,
      connection,
      hideRoot,
      discardSelection,
      sessionIssue,
      detachVisit,
    ],
  );
  function choose(row: ThreadInboxRow) {
    if (!inbox || !row.post || inbox.isRootUnavailable(row.id)) return;
    if (selection?.id === row.id && selection.row && !selection.issue) return;
    parkCurrent.current?.capture();
    parkCurrent.current = null;
    opening.current?.controller.abort();
    detachVisit();
    setRestoring(undefined);
    const { id, post } = row;
    const request = {
      id,
      channelId: post.channelId,
      controller: new AbortController(),
    };
    opening.current = request;
    inbox.select(id);
    setSelection({
      id,
      row,
      post,
      opening: true,
      issue: null,
      parked:
        inbox.takeWindow(post.channelId, id) ??
        (selection?.id === id ? selection.parked : undefined),
    });
    return readRoot(request);
  }
  const confirmFollowing = useCallback(
    (id: string, following: boolean) => {
      if (following) void inbox?.confirmFollow();
      else void inbox?.confirmUnfollow(id);
    },
    [inbox],
  );
  const selectedId = selection?.id;
  const selectedVisit = selection?.visit;
  const selectionReady = Boolean(selection?.post && !selection.opening);
  async function confirmView(signal: AbortSignal) {
    if (
      !inbox ||
      !selectedId ||
      !selectedVisit ||
      !selectionReady ||
      inbox.isRootUnavailable(selectedId) ||
      !connected.current
    )
      throw Error("No active thread to mark");
    try {
      const outcome = await selectedVisit.auto(signal);
      if (outcome.kind === "confirmed" && !inbox.isRootUnavailable(selectedId))
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
          hideRoot(selectedId, "forbidden");
      }
      throw error;
    }
  }
  async function checkView(signal: AbortSignal, onRevoked: () => void) {
    if (
      !inbox ||
      !selectedId ||
      !selectedVisit?.getAutoReview() ||
      inbox.isRootUnavailable(selectedId)
    )
      return;
    const active = () =>
      !signal.aborted && currentVisit.current?.visit === selectedVisit;
    try {
      const { following: _following, ...mark } =
        await selectedVisit.observe(signal);
      if (active() && !inbox.isRootUnavailable(selectedId))
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
        hideRoot(selectedId, "forbidden");
      }
    }
  }
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
    selectedId: accessDenied ? undefined : (paused ? selection : active)?.id,
    restoring: Boolean(restoring),
    selection:
      active && denied
        ? deniedSelection(
            active,
            active.issue === "limited" ? "limited" : "forbidden",
          )
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
