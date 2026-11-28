import { useEffectEvent, useLayoutEffect, useMemo, useState } from "react";
import {
  type ListPage,
  nearbyPages,
  type PageReading,
  pageRows,
  type RowPlace,
  rememberList,
  withinPlace,
} from "./channel-list-reading.ts";
import { workspaceFailure } from "./workspace-data.ts";

type Status = "loading" | "ready" | "failed" | "denied";
type Read = {
  kind: "first" | "refresh" | "edge";
  pages: readonly number[];
  retry?: boolean;
};
type State<Row> = {
  status: Status;
  pages: readonly ListPage<Row>[];
  request: Read;
};

function initial<Row>(previous?: PageReading<Row>): State<Row> {
  return {
    status: "loading",
    pages: previous?.pages ?? [],
    request: previous
      ? { kind: "refresh", pages: previous.pages.map(({ page }) => page) }
      : { kind: "first", pages: [0] },
  };
}

export function useChannelListPages<Row>({
  history,
  channelId,
  query = "",
  online,
  load,
  id,
  sessionIssue,
}: {
  history?: Map<string, PageReading<Row>>;
  channelId: string;
  query?: string;
  online: boolean;
  load: (page: number, signal: AbortSignal) => Promise<ListPage<Row>>;
  id: (row: Row) => string;
  sessionIssue: (reason: "session" | "unauthorized") => void;
}) {
  const [start, setStart] = useState(() =>
    online ? history?.get(channelId) : undefined,
  );
  const [state, setState] = useState(() => initial(start));
  const [scope, setScope] = useState({ online, query, history, channelId });
  if (
    scope.online !== online ||
    scope.query !== query ||
    scope.history !== history ||
    scope.channelId !== channelId
  ) {
    setScope({ online, query, history, channelId });
    if (
      state.status !== "denied" ||
      scope.online !== online ||
      scope.history !== history ||
      scope.channelId !== channelId
    ) {
      const saved =
        online && scope.query === query ? history?.get(channelId) : undefined;
      setStart(saved);
      setState(initial(saved));
    }
  }
  const read = useEffectEvent(load);
  const report = useEffectEvent(sessionIssue);
  const request = state.status === "denied" ? null : state.request;
  useLayoutEffect(() => {
    if (!online || !request) return;
    const controller = new AbortController();
    const { signal } = controller;
    async function run(attempt: Read) {
      try {
        const received: ListPage<Row>[] = [];
        for (const page of attempt.pages) {
          const next = await read(page, signal);
          signal.throwIfAborted();
          received.push(next);
          if (next.next === null) break;
        }
        // Empty numbered pages do not establish an empty section. A list
        // that shrank past the retained window starts again at its first page.
        if (
          attempt.kind === "refresh" &&
          received[0].page > 0 &&
          received.every(({ rows }) => rows.length === 0)
        ) {
          received.splice(0, received.length, await read(0, signal));
          signal.throwIfAborted();
        }
        setState((old) =>
          old.request !== attempt
            ? old
            : {
                ...old,
                status: "ready",
                pages:
                  attempt.kind === "edge"
                    ? [...old.pages, ...received].sort(
                        (a, b) => a.page - b.page,
                      )
                    : received,
              },
        );
      } catch (cause) {
        if (signal.aborted) return;
        const failure = workspaceFailure(cause, "network");
        const terminal =
          failure === "forbidden" ||
          failure === "unauthorized" ||
          failure === "session";
        if (terminal) history?.delete(channelId);
        if (failure === "unauthorized" || failure === "session")
          report(failure);
        setState((old) =>
          old.request !== attempt
            ? old
            : {
                ...old,
                status: terminal ? "denied" : "failed",
                pages: terminal ? [] : old.pages,
              },
        );
      }
    }
    const timer =
      query && request.kind === "first" && !request.retry
        ? window.setTimeout(() => void run(request), 100)
        : undefined;
    if (timer === undefined) void run(request);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [request, online, history, channelId, query]);

  const rows = useMemo(() => pageRows(state.pages, id), [state.pages, id]);
  const first = state.pages[0]?.page ?? 0;
  const before = first > 0 ? first - 1 : null;
  const next = state.pages.at(-1)?.next ?? null;
  function more(page: number) {
    setState((old) =>
      old.status === "ready"
        ? {
            ...old,
            status: "loading",
            request: { kind: "edge", pages: [page] },
          }
        : old,
    );
  }
  function retry() {
    setState((old) =>
      old.status === "failed"
        ? {
            ...old,
            status: "loading",
            request: { ...old.request, retry: true },
          }
        : old,
    );
  }
  function remember(place: RowPlace) {
    if (!history || !online || !state.pages.length) return;
    const pages = nearbyPages(state.pages, place, id);
    rememberList(history, channelId, {
      pages,
      place: withinPlace(place, pageRows(pages, id).map(id)),
      query,
    });
  }

  return {
    state,
    rows,
    before,
    next,
    more,
    retry,
    remember,
    start: start?.place,
    acrossBefore: request?.kind === "edge" && request.pages[0] < first,
    readingMore: request?.kind === "edge",
    rechecking: request?.kind === "refresh",
  };
}
