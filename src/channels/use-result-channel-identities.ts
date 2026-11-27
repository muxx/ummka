import { useEffect, useEffectEvent, useMemo, useState } from "react";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";

type Reader = Pick<WorkspaceConnection, "readChannelIdentity">;
type Room = Awaited<ReturnType<Reader["readChannelIdentity"]>>;
const empty: ReadonlyMap<string, Room> = new Map();

// Keep outstanding lookups with the result set that requested them. Appending a
// page may add work, but must not restart a lookup from a previous page.
export function useResultChannelIdentities(
  account: Reader,
  owner: object | null,
  missing: ReadonlySet<string>,
  online: boolean,
  sessionIssue: (issue: "session" | "unauthorized") => void,
) {
  const scope = useMemo(
    () => ({
      account,
      owner,
      ended: false,
      pending: new Map<string, AbortController>(),
      tried: new Set<string>(),
      resume: undefined as (() => void) | undefined,
    }),
    [account, owner],
  );
  const [published, setPublished] = useState<{
    scope: typeof scope;
    rooms: ReadonlyMap<string, Room>;
  } | null>(null);
  const onSessionIssue = useEffectEvent(sessionIssue);
  useEffect(
    () => () => {
      for (const request of scope.pending.values()) request.abort();
      scope.pending.clear();
      scope.tried.clear();
    },
    [scope],
  );
  useEffect(() => {
    for (const [id, request] of scope.pending) {
      if (!online || !missing.has(id)) {
        request.abort();
        scope.pending.delete(id);
        scope.tried.delete(id);
      }
    }
    if (!online || !scope.owner) return;

    // Each result page can contain dozens of different conversations.
    function start() {
      if (scope.ended) return;
      for (const id of missing) {
        if (scope.pending.size >= 4) return;
        if (scope.tried.has(id)) continue;
        const request = new AbortController();
        scope.tried.add(id);
        scope.pending.set(id, request);
        void scope.account
          .readChannelIdentity(id, request.signal)
          .then(
            (room) => {
              if (request.signal.aborted) return;
              setPublished((last) => ({
                scope,
                rooms: new Map(last?.scope === scope ? last.rooms : empty).set(
                  id,
                  room,
                ),
              }));
            },
            (error) => {
              if (request.signal.aborted) return;
              const reason = workspaceFailure(error, "network");
              if (reason === "unauthorized" || reason === "session") {
                scope.ended = true;
                for (const pending of scope.pending.values()) pending.abort();
                scope.pending.clear();
                setPublished(null);
                onSessionIssue(reason);
              }
            },
          )
          .finally(() => {
            if (scope.pending.get(id) !== request) return;
            scope.pending.delete(id);
            scope.resume?.();
          });
      }
    }
    scope.resume = start;
    start();
    return () => {
      scope.resume = undefined;
    };
  }, [scope, missing, online]);
  return published?.scope === scope ? published.rooms : empty;
}
