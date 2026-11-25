import {
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ResponseError } from "../../vendor/mattermost/index.js";
import {
  useAccountPolicy,
  useDeviceOnline,
} from "../channels/use-workspace-read";
import {
  type JoinedTeam,
  type JoinedTeams,
  orderJoinedTeams,
} from "../mattermost/joined-teams";
import { openAccountRestConnection } from "../mattermost/native-rest";
import { EntryWindow } from "./EntryWindow";
import type { EntryLanguage } from "./language";
import { teamText } from "./team-text";
import "./connect.css";
import "./team-window.css";

type Connection = Awaited<ReturnType<typeof openAccountRestConnection>>;
export type TeamWorkspace = {
  serverUrl: string;
  userId: string;
  team: JoinedTeam;
  connection: Connection;
  directoryNotice: Issue | null;
  chooseAnotherTeam: () => void;
  policy: ReturnType<typeof useAccountPolicy>;
  online: boolean;
  sessionIssue: (issue: "session" | "unauthorized") => void;
};
type Props = {
  serverUrl: string;
  userId: string;
  language: EntryLanguage;
  onSessionEnded: () => void;
  children: (workspace: TeamWorkspace) => ReactNode;
};

export function AccountTeamWindow(props: Props) {
  const [attempt, setAttempt] = useState(0);
  // Remount the account scope before rendering a replacement login or retrying storage.
  return (
    <AccountWindow
      key={JSON.stringify([props.serverUrl, props.userId, attempt])}
      {...props}
      retry={() => setAttempt((value) => value + 1)}
    />
  );
}

type Issue = "storage" | "network" | "offline" | "noCache" | "chooseFailed";

function AccountWindow({
  serverUrl,
  userId,
  language,
  onSessionEnded,
  children,
  retry,
}: Props & { retry: () => void }) {
  const text = teamText[language];
  const [directory, setDirectory] = useState<JoinedTeams | null>(null);
  const [notice, setNotice] = useState<Issue | null>(null);
  const [picker, setPicker] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const connection = useRef<Connection | null>(null);
  const online = useDeviceOnline();
  const policy = useAccountPolicy(
    directory ? connection.current : null,
    directory,
    online,
  );
  const invalidation = useRef<
    ((issue: "session" | "unauthorized") => void) | null
  >(null);
  const sessionIssue = useCallback(
    (issue: "session" | "unauthorized") => invalidation.current?.(issue),
    [],
  );
  const selection = useRef(false);
  const readVersion = useRef(0);
  const retryRemoval = useRef<(() => void) | null>(null);
  const ended = useEffectEvent(onSessionEnded);
  const read = useCallback(async (current: Connection) => {
    const version = ++readVersion.current;
    const active = () =>
      connection.current === current && version === readVersion.current;
    let snapshot: JoinedTeams | null;
    try {
      snapshot = await current.readJoinedTeams();
    } catch (error) {
      if (active()) throw error;
      return;
    }
    if (!active()) return;
    setDirectory(snapshot);
    setNotice((previous) => (previous === "storage" ? null : previous));
    return snapshot;
  }, []);
  const currentTeamButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (picker) currentTeamButton.current?.focus();
  }, [picker]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let acquired: Connection | null = null;
    let initial: JoinedTeams | null | undefined;
    function withdraw() {
      connection.current = null;
      readVersion.current++;
      setChoosing(false);
      setDirectory(null);
      setNotice(null);
    }
    async function removeRejectedSession(current: Connection) {
      retryRemoval.current = null;
      setNotice(null);
      try {
        await current.signOutOnDevice();
        if (!signal.aborted) ended();
      } catch {
        if (!signal.aborted) {
          retryRemoval.current = () => void removeRejectedSession(current);
          setNotice("storage");
        }
      }
    }
    let invalidated = false;
    invalidation.current = (issue) => {
      if (signal.aborted || invalidated || !acquired) return;
      invalidated = true;
      withdraw();
      if (issue === "unauthorized") void removeRejectedSession(acquired);
      else ended();
    };
    async function load() {
      try {
        acquired = await openAccountRestConnection(serverUrl, userId);
        if (signal.aborted) {
          await acquired.close();
          return;
        }
        connection.current = acquired;
        initial = await read(acquired);
      } catch (error) {
        if (signal.aborted) return;
        if (error === "session_unavailable" || error === "cancelled") {
          withdraw();
          ended();
        } else setNotice("storage");
        return;
      }
      if (signal.aborted) return;
      await refresh();
    }
    async function refresh() {
      if (!acquired || signal.aborted || invalidated) return;
      if (!navigator.onLine) {
        setNotice(initial ? "offline" : "noCache");
        return;
      }
      try {
        await acquired.refreshJoinedTeams(signal);
      } catch (error) {
        if (signal.aborted || invalidated) return;
        if (error === "session_unavailable" || error === "cancelled") {
          withdraw();
          ended();
          return;
        }
        if (error instanceof ResponseError && error.response.status === 401) {
          invalidation.current?.("unauthorized");
        } else {
          const storage =
            typeof error === "string" &&
            [
              "history_storage_unavailable",
              "credential_storage_unavailable",
              "invalid_stored_credential",
            ].includes(error);
          setNotice(storage ? "storage" : "network");
        }
        return;
      }
      if (!signal.aborted && !invalidated) {
        try {
          const published = await read(acquired);
          if (!signal.aborted && !invalidated && published === null)
            setNotice("network");
        } catch {
          if (!signal.aborted && !invalidated) setNotice("storage");
        }
      }
    }
    const reconnect = () => {
      void refresh();
    };
    window.addEventListener("online", reconnect);
    void load();
    return () => {
      window.removeEventListener("online", reconnect);
      invalidation.current = null;
      controller.abort();
      readVersion.current++;
      connection.current = null;
      if (acquired) void acquired.close().catch(() => {});
    };
  }, [serverUrl, userId, read]);

  async function choose(team: JoinedTeam) {
    const current = connection.current;
    if (!current || selection.current) return;
    selection.current = true;
    setChoosing(true);
    readVersion.current++;
    try {
      const accepted = await current.selectJoinedTeam(team.id);
      if (connection.current !== current) return;
      if (accepted) {
        // The selection was committed while this connection still owned the account.
        setDirectory(
          (previous) => previous && { ...previous, selectedTeam: team.id },
        );
        setPicker(false);
        setNotice((previous) =>
          previous === "chooseFailed" ? null : previous,
        );
      } else {
        setNotice("chooseFailed");
      }
      try {
        await read(current);
      } catch {
        if (connection.current === current) setNotice("storage");
      }
    } catch {
      if (connection.current === current) setNotice("chooseFailed");
    } finally {
      if (connection.current === current) {
        selection.current = false;
        setChoosing(false);
      }
    }
  }

  const teams = directory?.teams ?? [];
  const selected = teams.find((team) => team.id === directory?.selectedTeam);
  if (selected && connection.current && !picker) {
    return children({
      serverUrl,
      userId,
      team: selected,
      connection: connection.current,
      online,
      policy,
      sessionIssue,
      directoryNotice: notice,
      chooseAnotherTeam: () => setPicker(true),
    });
  }
  return (
    <EntryWindow>
      <h1>{text.title}</h1>
      <p className="entry-address" dir="ltr">
        {serverUrl}
      </p>
      {teams.length > 0 && (
        <ul className="entry-teams">
          {orderJoinedTeams(teams, language).map((team) => (
            <li key={team.id}>
              <button
                type="button"
                className="entry-team"
                ref={
                  team.id === directory?.selectedTeam
                    ? currentTeamButton
                    : undefined
                }
                aria-current={
                  team.id === directory?.selectedTeam ? "true" : undefined
                }
                aria-labelledby={`team-title-${team.id}`}
                aria-describedby={`team-slug-${team.id}`}
                disabled={choosing}
                onClick={() => void choose(team)}
              >
                <span aria-hidden="true" className="entry-team-initial">
                  {Array.from(team.displayName || team.name)[0]}
                </span>
                <span>
                  <strong id={`team-title-${team.id}`}>
                    {team.displayName || team.name}
                  </strong>
                  <small
                    id={`team-slug-${team.id}`}
                    dir="ltr"
                  >{`/${team.name}`}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {directory && !teams.length && <p>{text.empty}</p>}
      {!notice && !directory && <p role="status">{text.loading}</p>}
      {notice && (
        <p role={notice === "offline" ? "status" : "alert"}>{text[notice]}</p>
      )}
      {(notice || (directory && !teams.length)) && (
        <button
          type="button"
          className="entry-primary"
          onClick={() => (retryRemoval.current ?? retry)()}
        >
          {text.retry}
        </button>
      )}
    </EntryWindow>
  );
}
