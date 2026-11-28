import { useEffect, useEffectEvent, useState } from "react";
import { workspaceFailure } from "./workspace-data.ts";

export type SectionValue<T> =
  | { status: "ready"; value: T }
  | { status: "loading" | "failed" | "offline" | "denied" };
export function useInfoRead<T>(
  scope: string | null,
  online: boolean,
  read: (signal: AbortSignal, scope: string) => Promise<T>,
  sessionIssue: (reason: "session" | "unauthorized") => void,
  denied?: () => void,
  revision = 0,
) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<
    | (SectionValue<T> & { scope: string; attempt: number; revision: number })
    | null
  >(null);
  const start = useEffectEvent(read),
    session = useEffectEvent(sessionIssue),
    deny = useEffectEvent(() => denied?.());
  useEffect(() => {
    if (scope === null || !online) {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    setResult({ scope, attempt, revision, status: "loading" });
    void start(controller.signal, scope).then(
      (value) => {
        if (!controller.signal.aborted)
          setResult({ scope, attempt, revision, status: "ready", value });
      },
      (reason) => {
        if (controller.signal.aborted) return;
        const issue = workspaceFailure(reason, "network");
        if (issue === "session" || issue === "unauthorized") {
          session(issue);
          return;
        }
        if (issue === "forbidden") {
          setResult({ scope, attempt, revision, status: "denied" });
          deny();
          return;
        }
        setResult({ scope, attempt, revision, status: "failed" });
      },
    );
    return () => controller.abort();
  }, [scope, online, attempt, revision]);
  return {
    value: online
      ? result !== null &&
        result.scope === scope &&
        result.attempt === attempt &&
        result.revision === revision
        ? result
        : { status: "loading" as const }
      : { status: "offline" as const },
    retry: () => setAttempt((n) => n + 1),
  };
}
