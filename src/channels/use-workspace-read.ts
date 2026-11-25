import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { JoinedTeams } from "../mattermost/joined-teams.ts";
import type { openAccountRestConnection } from "../mattermost/native-rest.ts";
import type { SidebarPreferences } from "../mattermost/workspace-preferences.ts";
import { observeWorkspaceRead, type WorkspaceRead } from "./workspace-data.ts";

export type WorkspaceConnection = Awaited<
  ReturnType<typeof openAccountRestConnection>
>;
function listenNetwork(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}
export function useDeviceOnline() {
  return useSyncExternalStore(listenNetwork, () => navigator.onLine);
}

export function useWorkspaceRead<T>(
  scope: string | null,
  online: boolean,
  read: () => Promise<T | null>,
  refresh: (signal: AbortSignal) => Promise<unknown>,
) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    scope: string;
    attempt: number;
    state: WorkspaceRead<T>;
  } | null>(null);
  useEffect(() => {
    if (scope === null) return;
    const controller = new AbortController();
    void observeWorkspaceRead({
      signal: controller.signal,
      online,
      read,
      refresh,
      publish: (state) => setResult({ scope, attempt, state }),
    });
    return () => controller.abort();
  }, [scope, online, read, refresh, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const state: WorkspaceRead<T> =
    result && scope === result.scope
      ? result.attempt === attempt
        ? result.state
        : { ...result.state, status: "refreshing" }
      : { value: null, status: "loading" };
  return { state, retry };
}

export function useAccountPolicy(
  connection: WorkspaceConnection | null,
  directory: JoinedTeams | null,
  online: boolean,
) {
  const scope = connection ? String(connection.rid) : null;
  const loadServer = useCallback(
    async () =>
      connection ? (await connection.readWorkspaceSettings()).server : null,
    [connection],
  );
  const refreshServer = useCallback(
    (signal: AbortSignal) =>
      connection
        ? connection.refreshWorkspaceServerPolicy(signal)
        : Promise.resolve(false),
    [connection],
  );
  const server = useWorkspaceRead(scope, online, loadServer, refreshServer);
  const readUser = useCallback(
    async () =>
      connection && directory
        ? (await connection.readWorkspaceSettings()).preferences
        : null,
    [connection, directory],
  );
  const user = useWorkspaceRead<SidebarPreferences>(
    scope,
    false,
    readUser,
    noRefresh,
  );
  return {
    server: server.state,
    user: user.state.value,
    userReadFailed: user.state.status === "storage",
    retry: () => {
      server.retry();
      user.retry();
    },
  };
}

async function noRefresh() {}
