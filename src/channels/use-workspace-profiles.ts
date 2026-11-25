import { useEffect, useRef, useState } from "react";
import type { SavedProfiles } from "../mattermost/native-rest.ts";
import type { VisibleProfileQuery } from "../mattermost/visible-profiles.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";

const empty: SavedProfiles = { profiles: {}, usernames: {} };
export function useWorkspaceProfiles(
  connection: WorkspaceConnection,
  query: VisibleProfileQuery,
  online: boolean,
  sessionIssue: (issue: "session" | "unauthorized") => void,
) {
  const key = JSON.stringify([query.ids, query.usernames]);
  const [result, setResult] = useState<{
    scope: string;
    rows: SavedProfiles;
  } | null>(null);
  const checked = useRef<{
    connection: WorkspaceConnection;
    online: boolean;
    ids: Set<string>;
    names: Set<string>;
  } | null>(null);
  useEffect(() => {
    if (
      !checked.current ||
      checked.current.connection !== connection ||
      checked.current.online !== online
    )
      checked.current = {
        connection,
        online,
        ids: new Set<string>(),
        names: new Set<string>(),
      };
    const seen = checked.current;
    const controller = new AbortController();
    const { signal } = controller;
    const [ids, usernames]: [string[], string[]] = JSON.parse(key);
    const keys = { ids, usernames };
    async function load() {
      const saved = await connection.readSavedProfiles(keys);
      if (signal.aborted) return;
      setResult({ scope: key, rows: saved });
      if (!online) return;

      const missing = {
        ids: ids.filter((id) => !seen.ids.has(id)),
        usernames: usernames.filter((name) => !seen.names.has(name)),
      };
      if (!missing.ids.length && !missing.usernames.length) return;
      await connection.refreshSavedProfiles(missing, signal);
      if (signal.aborted) return;
      const rows = await connection.readSavedProfiles(keys);
      if (signal.aborted) return;
      for (const id of missing.ids) seen.ids.add(id);
      for (const name of missing.usernames) seen.names.add(name);
      setResult({ scope: key, rows });
    }
    void load().catch((error) => {
      if (signal.aborted) return;
      const issue = workspaceFailure(error, "network");
      if (issue === "unauthorized" || issue === "session") sessionIssue(issue);
      if (issue === "forbidden") setResult({ scope: key, rows: empty });
    });
    return () => controller.abort();
  }, [connection, key, online, sessionIssue]);
  return result?.scope === key ? result.rows : empty;
}
