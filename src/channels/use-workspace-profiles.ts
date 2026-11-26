import { useEffect, useMemo, useRef, useState } from "react";
import type { SavedProfiles } from "../mattermost/native-rest.ts";
import type { VisibleProfileQuery } from "../mattermost/visible-profiles.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";

type ProfileConnection = Pick<
  WorkspaceConnection,
  "readSavedProfiles" | "refreshSavedProfiles"
>;

const empty: SavedProfiles = { profiles: {}, usernames: {} };
export function useWorkspaceProfiles(
  connection: ProfileConnection,
  query: VisibleProfileQuery,
  online: boolean,
  sessionIssue: (issue: "session" | "unauthorized") => void,
) {
  const key = JSON.stringify([query.ids, query.usernames]);
  const keys = useMemo<VisibleProfileQuery>(() => {
    const [ids, usernames]: [string[], string[]] = JSON.parse(key);
    return { ids, usernames };
  }, [key]);
  const [result, setResult] = useState<{
    connection: ProfileConnection;
    keys: VisibleProfileQuery;
    rows: SavedProfiles;
  } | null>(null);
  const checked = useRef<{
    connection: ProfileConnection;
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
    const { ids, usernames } = keys;
    async function load() {
      const saved = await connection.readSavedProfiles(keys);
      if (signal.aborted) return;
      setResult({ connection, keys, rows: saved });
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
      setResult({ connection, keys, rows });
    }
    void load().catch((error) => {
      if (signal.aborted) return;
      const issue = workspaceFailure(error, "network");
      if (
        issue === "forbidden" ||
        issue === "unauthorized" ||
        issue === "session"
      )
        setResult({ connection, keys, rows: empty });
      if (issue === "unauthorized" || issue === "session") sessionIssue(issue);
    });
    return () => controller.abort();
  }, [connection, keys, online, sessionIssue]);

  return useMemo(() => {
    if (result?.connection !== connection) return empty;
    if (result.keys === keys) return result.rows;
    // While new authors load, keep the already resolved members still requested by this view.
    const names = new Set(keys.usernames);
    const usernames = Object.fromEntries(
      Object.entries(result.rows.usernames).filter(([name]) => names.has(name)),
    );
    const ids = new Set([...keys.ids, ...Object.values(usernames)]);
    const profiles = Object.fromEntries(
      Object.entries(result.rows.profiles).filter(([id]) => ids.has(id)),
    );
    return { profiles, usernames };
  }, [connection, keys, result]);
}
