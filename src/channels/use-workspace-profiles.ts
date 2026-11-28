import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ChannelProfile } from "../mattermost/channel-profiles.ts";
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
) {
  const key = JSON.stringify([query.ids, query.usernames]);
  const keys = useMemo<VisibleProfileQuery>(() => {
    const [ids, usernames]: [string[], string[]] = JSON.parse(key);
    return { ids, usernames };
  }, [key]);
  const authors = authorsFor(connection);
  const [owner] = useState(() => ({}));
  useLayoutEffect(() => () => authors.pin(owner, []), [authors, owner]);
  useLayoutEffect(() => authors.pin(owner, keys.ids), [authors, owner, keys]);
  const [result, setResult] = useState<{
    connection: ProfileConnection;
    aliases: ChannelProfile[];
  } | null>(null);
  const aliases = useMemo(() => {
    if (result?.connection !== connection) return [];
    const names = new Set(keys.usernames);
    return result.aliases.filter(({ username }) => names.has(username));
  }, [connection, keys, result]);
  const select = useMemo(
    () => authors.select([...keys.ids, ...aliases.map(({ id }) => id)]),
    [authors, keys, aliases],
  );
  const selected = useSyncExternalStore(authors.subscribe, select);
  const checked = useRef<{
    connection: ProfileConnection;
    online: boolean;
    names: Set<string>;
  } | null>(null);
  useEffect(() => {
    if (
      !checked.current ||
      checked.current.connection !== connection ||
      checked.current.online !== online
    )
      checked.current = { connection, online, names: new Set<string>() };
    const seen = checked.current;
    const controller = new AbortController();
    const { signal } = controller;
    const { ids, usernames } = keys;
    const names = new Set(usernames);
    for (const name of seen.names)
      if (!names.has(name)) seen.names.delete(name);
    const read = authors.begin(ids);
    let attempted = ids;

    function publishNames(rows: SavedProfiles) {
      // Only SQLite's current, unambiguous lookup can resolve a username.
      const aliases = usernames.flatMap((name) => {
        const profile = rows.profiles[rows.usernames[name]];
        return profile?.username === name ? [profile] : [];
      });
      setResult({ connection, aliases });
    }

    async function load() {
      const saved = await connection.readSavedProfiles(keys);
      if (signal.aborted) return;
      read.publish(ids, (id) => saved.profiles[id], "saved");
      publishNames(saved);
      if (!online) return;

      const missing = {
        ids: ids.filter((id) => !authors.verified(id, seen)),
        usernames: usernames.filter((name) => !seen.names.has(name)),
      };
      if (!missing.ids.length && !missing.usernames.length) return;
      attempted = missing.ids;
      const refreshed = await connection.refreshSavedProfiles(missing, signal);
      if (signal.aborted) return;
      const returned = new Map(
        refreshed.map((profile) => [profile.id, profile]),
      );
      read.publish(missing.ids, (id) => returned.get(id), "server", seen);
      attempted = ids;
      const rows = await connection.readSavedProfiles(keys);
      if (signal.aborted) return;
      // The SQLite echo may contain older fields. It can still supply a
      // newer version written by another process and resolve current aliases.
      read.publish(
        ids.filter(
          (id) => !returned.has(id) || rows.profiles[id] !== undefined,
        ),
        (id) => rows.profiles[id],
        "saved",
      );
      for (const name of missing.usernames) seen.names.add(name);
      publishNames(rows);
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
        setResult(null);
      })
      .finally(read.stop);
    return () => {
      controller.abort();
      read.stop();
    };
  }, [connection, authors, keys, online, sessionIssue]);

  return useMemo(() => {
    const profiles: SavedProfiles["profiles"] = {};
    const usernames: SavedProfiles["usernames"] = {};
    for (const id of keys.ids) {
      const profile = selected.get(id);
      if (profile) profiles[id] = profile;
    }
    for (const alias of aliases) {
      const selectedProfile = selected.get(alias.id);
      const profile = selectedProfile === undefined ? alias : selectedProfile;
      if (profile?.username !== alias.username) continue;
      profiles[profile.id] = profile;
      usernames[profile.username] = profile.id;
    }
    return { profiles, usernames };
  }, [keys, aliases, selected]);
}
