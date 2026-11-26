import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createTimelineReader,
  type TimelineAccount,
  type TimelineRequest,
} from "./timeline-reader.ts";

export function useChannelTimeline(
  connection: TimelineAccount,
  teamId: string,
  channelId: string | null,
  collapsed: boolean | null,
  online: boolean,
  sessionIssue: (issue: "session" | "unauthorized") => void,
  request?: TimelineRequest,
) {
  const focus = request?.kind === "focus" ? request : undefined;
  const key = JSON.stringify([
    connection.rid,
    teamId,
    channelId,
    collapsed,
    request?.kind,
    request?.requestId,
    focus?.rid,
    focus?.teamId,
    focus?.post.channelId,
    focus?.post.id,
  ]);
  const owner = () => ({
    key,
    connection,
    reader: createTimelineReader(
      connection,
      teamId,
      channelId,
      collapsed,
      request,
    ),
  });
  const [current, setCurrent] = useState(owner);
  if (current.key !== key || current.connection !== connection)
    setCurrent(owner);
  const { reader } = current;
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  useLayoutEffect(() => () => reader.stop(), [reader]);
  useLayoutEffect(() => reader.setOnline(online), [online, reader]);
  const report = useEffectEvent(sessionIssue);
  useEffect(() => {
    if (
      reader.getSnapshot().status === state.status &&
      (state.status === "session" || state.status === "unauthorized")
    )
      report(state.status);
  }, [state.status, reader]);
  return { ...state, retry: reader.retry, loadEdge: reader.loadEdge };
}
