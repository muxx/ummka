import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { SavedProfiles } from "../mattermost/native-rest.ts";
import type { VisibleProfileQuery } from "../mattermost/visible-profiles.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { createWarmAuthorProfiles } from "./warm-author-profiles.ts";
import { workspaceFailure } from "./workspace-data.ts";

type ProfileConnection = Pick<
  WorkspaceConnection,
  "readSavedProfiles" | "refreshSavedProfiles"
>;
const warm = new WeakMap<
  ProfileConnection,
  ReturnType<typeof createWarmAuthorProfiles>
>();
const empty: SavedProfiles = { profiles: {}, usernames: {} };

function authorsFor(connection: ProfileConnection) {
  let authors = warm.get(connection);
  if (!authors) {
    authors = createWarmAuthorProfiles();
    warm.set(connection, authors);
  }
  return authors;
}

export function useWorkspaceProfiles(
  connection: ProfileConnection,
  query: VisibleProfileQuery,
  online: boolean,
  sessionIssue: (issue: "session" | "unauthorized") => void,
  postAuthorIds = query.ids,
) {
  const key = JSON.stringify([query.ids, query.usernames, postAuthorIds]);
  const { keys, authorIds } = useMemo(() => {
    const [ids, usernames, authors]: [string[], string[], string[]] =
      JSON.parse(key);
    const requested = new Set(ids);
    return {
      keys: { ids, usernames },
      authorIds: authors.filter((id) => requested.has(id)),
    };
  }, [key]);
  const authors = authorsFor(connection);
  const [owner] = useState(() => ({}));
  useLayoutEffect(() => () => authors.pin(owner, []), [authors, owner]);
  useLayoutEffect(
    () => authors.pin(owner, authorIds),
    [authors, owner, authorIds],
  );
  const select = useMemo(() => authors.select(authorIds), [authors, authorIds]);
  const selected = useSyncExternalStore(authors.subscribe, select);
  const [result, setResult] = useState<{
    connection: ProfileConnection;
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
    const read = authors.begin(authorIds);
    const scopedAuthors = new Set(authorIds);
    let attempted: readonly string[] = ids;
    async function load() {
      const saved = await connection.readSavedProfiles(keys);
      if (signal.aborted) return;
      read.publish(authorIds, (id) => saved.profiles[id], "saved");
      setResult({ connection, rows: saved });
      if (!online) return;

      const missing = {
        ids: ids.filter(
          (id) =>
            !seen.ids.has(id) || (scopedAuthors.has(id) && authors.refused(id)),
        ),
        usernames: usernames.filter((name) => !seen.names.has(name)),
      };
      if (!missing.ids.length && !missing.usernames.length) return;
      attempted = missing.ids;
      const refreshed = await connection.refreshSavedProfiles(missing, signal);
      if (signal.aborted) return;
      const returned = new Set(refreshed.map(({ id }) => id));
      const verified = new Set(missing.ids);
      // Publish omissions before reopening SQLite, which can still hold old rows.
      read.publish(
        missing.ids.filter((id) => !returned.has(id)),
        () => undefined,
        "server",
      );
      attempted = ids;
      const rows = await connection.readSavedProfiles(keys);
      if (signal.aborted) return;
      read.publish(
        authorIds.filter((id) => !verified.has(id)),
        (id) => rows.profiles[id],
        "saved",
      );
      read.publish(
        missing.ids.filter((id) => returned.has(id)),
        (id) => rows.profiles[id],
        "server",
      );
      for (const id of missing.ids) seen.ids.add(id);
      for (const name of missing.usernames) seen.names.add(name);
      setResult({ connection, rows });
    }
    void load()
      .catch((error) => {
        if (signal.aborted) return;
        const issue = workspaceFailure(error, "network");
        if (issue === "forbidden")
          read.publish(attempted, () => undefined, "server");
        else if (issue === "unauthorized" || issue === "session") {
          authors.close();
          sessionIssue(issue);
        } else return;
        setResult({ connection, rows: empty });
      })
      .finally(read.stop);
    return () => {
      controller.abort();
      read.stop();
    };
  }, [connection, authorIds, authors, keys, online, sessionIssue]);

  return useMemo(() => {
    const rows = result?.connection === connection ? result.rows : empty;
    const names = new Set(keys.usernames);
    const usernames = Object.fromEntries(
      Object.entries(rows.usernames).filter(([name]) => names.has(name)),
    );
    const ids = new Set([...keys.ids, ...Object.values(usernames)]);
    const profiles = Object.fromEntries(
      Object.entries(rows.profiles).filter(([id]) => ids.has(id)),
    );
    for (const id of authorIds) {
      const author = selected.get(id);
      if (author) profiles[id] = author;
      else delete profiles[id];
    }
    return { profiles, usernames };
  }, [connection, keys, authorIds, result, selected]);
}
