import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalChannelWindow } from "../mattermost/local-history.ts";
import {
  useWorkspaceRead,
  type WorkspaceConnection,
} from "./use-workspace-read.ts";
import {
  channelPageSize,
  readTimelineEdge,
  workspaceFailure,
} from "./workspace-data.ts";

type Position = { scope: string; page: LocalChannelWindow };
export function useChannelTimeline(
  connection: WorkspaceConnection,
  channelId: string | null,
  collapsed: boolean | null,
  online: boolean,
  sessionIssue: (issue: "session" | "unauthorized") => void,
) {
  const scope =
    channelId !== null && collapsed !== null
      ? JSON.stringify([connection.rid, channelId, collapsed])
      : null;
  const [position, setPosition] = useState<Position | null>(null);
  const [boundary, setBoundary] = useState<{
    scope: string;
    notice:
      | "offline"
      | "unavailable"
      | "forbidden"
      | "storage"
      | "network"
      | null;
  } | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    setPosition((previous) => (previous?.scope === scope ? previous : null));
    setBoundary((previous) => (previous?.scope === scope ? previous : null));
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [scope]);
  const read = useCallback(
    () =>
      channelId && collapsed !== null
        ? connection.readChannelWindow({
            kind: "latest",
            channelId,
            collapsedThreads: collapsed,
            limit: channelPageSize,
          })
        : Promise.resolve(null),
    [channelId, collapsed, connection],
  );
  const refresh = useCallback(
    async (signal: AbortSignal) => {
      if (!channelId || collapsed === null || !scope) return;
      await connection.refreshChannelHistory(
        {
          kind: "latest",
          channelId,
          collapsedThreads: collapsed,
          perPage: channelPageSize,
        },
        signal,
      );
    },
    [channelId, collapsed, scope, connection],
  );
  const { state, retry } = useWorkspaceRead(scope, online, read, refresh);
  const restricted =
    scope !== null && boundary?.scope === scope ? boundary : null;
  const denied =
    state.status === "forbidden" ||
    restricted?.notice === "forbidden" ||
    state.status === "session" ||
    state.status === "unauthorized";
  const page = denied
    ? null
    : scope && position?.scope === scope
      ? position.page
      : state.value;
  useEffect(() => {
    if (state.status === "session" || state.status === "unauthorized")
      sessionIssue(state.status);
  }, [state.status, sessionIssue]);
  async function loadEdge(direction: "older" | "newer", postId: string) {
    if (!scope || !channelId || collapsed === null || !page || pending.current)
      return;
    const task = new AbortController();
    pending.current = task;
    try {
      const result = await readTimelineEdge(
        connection,
        channelId,
        collapsed,
        page,
        direction,
        postId,
        online,
        task.signal,
      );
      if (task.signal.aborted) return;
      if (result.status === "ready") {
        setPosition({ scope, page: result.page });
        setBoundary(null);
      } else setBoundary({ scope, notice: result.status });
    } catch (error) {
      if (task.signal.aborted) return;
      const problem = workspaceFailure(error, "network");
      if (problem === "unauthorized" || problem === "session")
        sessionIssue(problem);
      else setBoundary({ scope, notice: problem });
    } finally {
      if (pending.current === task) pending.current = null;
    }
  }
  return {
    page,
    status: state.status,
    notice: restricted?.notice ?? null,
    loadEdge,
    retry: () => {
      setBoundary(null);
      setPosition(null);
      retry();
    },
  };
}
