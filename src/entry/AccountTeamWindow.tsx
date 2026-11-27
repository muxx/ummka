import {
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useWorkspaceBack } from "../channels/use-workspace-back.ts";
import {
  useAccountPolicy,
  useDeviceOnline,
} from "../channels/use-workspace-read";
import {
  atDirectoryStep,
  directoryProblem,
} from "../mattermost/account-directory-error";
import {
  type JoinedTeam,
  type JoinedTeams,
  orderJoinedTeams,
} from "../mattermost/joined-teams";
import { openAccountRestConnection } from "../mattermost/native-rest";
import { EntryWindow } from "./EntryWindow";
import type { EntryLanguage } from "./language";
import { teamText } from "./team-text";
import {
  type MessageNavigation,
  useMessageNavigation,
} from "./use-message-navigation";
import "./connect.css";
import "./team-window.css";

import { resumeChannelsLink } from "../mattermost/route-channels-link";
import type { SystemPostRequest } from "./use-system-permalink";

type Connection = Awaited<ReturnType<typeof openAccountRestConnection>>;
type SessionCleanup = { confirmed: boolean; cause: unknown };
export type TeamWorkspace = {
  serverUrl: string;
  userId: string;
  team: JoinedTeam;
  connection: Connection;
  directoryNotice: Issue | null;
  directoryCode?: string;
  chooseAnotherTeam: () => void;
  messages: MessageNavigation;
  systemPost?: SystemPostRequest;
  policy: ReturnType<typeof useAccountPolicy>;
  online: boolean;
  sessionIssue: (issue: "session" | "unauthorized") => void;
  exit: {
    cleanup: SessionCleanup | null;
    run: (
      mode: "server" | "device",
    ) => Promise<"unconfirmed" | "cleanup" | undefined>;
  };
};
type Props = {
  serverUrl: string;
  userId: string;
  language: EntryLanguage;
  onSessionEnded: () => void;
  systemPost?: SystemPostRequest;
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

type Problem = Exclude<ReturnType<typeof directoryProblem>, string>;
type Issue = Problem["issue"] | "offline" | "noCache" | "chooseFailed";
type Notice = Issue | Problem | null;
function issueOf(notice: Notice) {
  return typeof notice === "object" ? (notice?.issue ?? null) : notice;
}

function AccountWindow({
  serverUrl,
  userId,
  language,
  onSessionEnded,
  children,
  systemPost,
  retry,
}: Props & { retry: () => void }) {
  const text = teamText[language];
  const [directory, setDirectory] = useState<JoinedTeams | null>(null);
  const [report, setNotice] = useState<Notice>(null);
  const notice = issueOf(report);
  const directoryCode = typeof report === "object" ? report?.code : undefined;
  const [picker, setPicker] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [needsTeam, setNeedsTeam] = useState<SystemPostRequest | null>(null);
  const connection = useRef<Connection | null>(null);
  const exiting = useRef<"working" | "cleanup" | null>(null);
  const [cleanup, setCleanup] = useState<SessionCleanup | null>(null);
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
  const writes = useRef(Promise.resolve());
  const enqueue: MessageNavigation["enqueue"] = useCallback((work) => {
    const result = writes.current.then(work);
    writes.current = result.then(
      () => {},
      () => {},
    );
    return result;
  }, []);
  const selection = useRef(false);
  const readVersion = useRef(0);
  const retryRemoval = useRef<(() => void) | null>(null);
  const ended = useEffectEvent(onSessionEnded);
  const read = useCallback(
    async (current: Connection, isCurrent: () => boolean = () => true) => {
      const version = ++readVersion.current;
      const active = () =>
        connection.current === current &&
        version === readVersion.current &&
        isCurrent();
      let snapshot: JoinedTeams | null;
      try {
        snapshot = await atDirectoryStep("snapshot", () =>
          current.readJoinedTeams(),
        );
      } catch (error) {
        if (active()) throw error;
        return;
      }
      if (!active()) return;
      setDirectory(snapshot);
      setNotice((previous) =>
        issueOf(previous) === "storage" ? null : previous,
      );
      return snapshot;
    },
    [],
  );
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
    let refreshVersion = 0;
    invalidation.current = (issue) => {
      if (signal.aborted || invalidated || !acquired || exiting.current) return;
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
        const problem = directoryProblem(error);
        if (problem === "session" || problem === "unauthorized") {
          withdraw();
          ended();
        } else setNotice({ issue: "storage", code: problem.code });
        return;
      }
      if (signal.aborted) return;
      await refresh();
    }
    async function refresh() {
      if (!acquired || signal.aborted || invalidated || exiting.current) return;
      const version = ++refreshVersion;
      const active = () =>
        !signal.aborted &&
        !invalidated &&
        !exiting.current &&
        version === refreshVersion;
      if (!navigator.onLine) {
        setNotice(initial ? "offline" : "noCache");
        return;
      }
      try {
        await acquired.refreshJoinedTeams(signal);
      } catch (error) {
        const problem = directoryProblem(error);
        if (signal.aborted || invalidated || exiting.current) return;
        if (problem === "session") {
          withdraw();
          ended();
        } else if (problem === "unauthorized") {
          invalidation.current?.("unauthorized");
        } else if (active()) {
          setNotice(problem);
        }
        return;
      }
      if (active()) {
        try {
          const published = await read(acquired, active);
          if (active() && published !== undefined) {
            if (published === null)
              setNotice({ issue: "failed", code: "snapshot.unpublished" });
            else
              setNotice((previous) =>
                previous === "chooseFailed" ? previous : null,
              );
          }
        } catch (error) {
          if (active()) {
            const problem = directoryProblem(error);
            if (problem === "session" || problem === "unauthorized")
              invalidation.current?.(problem);
            else setNotice({ issue: "storage", code: problem.code });
          }
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

  async function runExit(
    mode: "server" | "device",
  ): Promise<"unconfirmed" | "cleanup" | undefined> {
    const current = connection.current;
    if (!current || exiting.current === "working") return;
    if (mode === "server" && exiting.current === "cleanup") return "cleanup";
    // Logout may revoke the credential before cleanup completes. Keep this
    // connection as the owner of cleanup even if a concurrent read sees a 401.
    exiting.current = "working";
    try {
      if (mode === "device") {
        await current.signOutOnDevice();
      } else {
        const result = await current.signOut();
        if (connection.current !== current) return;
        if (result.status === "unconfirmed") return "unconfirmed";
        if (result.status === "server_confirmed_local_removal_failed") {
          exiting.current = "cleanup";
          setCleanup({ confirmed: true, cause: result.cause });
          return "cleanup";
        }
      }
      if (connection.current === current) onSessionEnded();
    } catch (cause) {
      if (connection.current !== current) return;
      if (mode === "server") throw cause;
      exiting.current = "cleanup";
      setCleanup({ confirmed: cleanup?.confirmed ?? false, cause });
      return "cleanup";
    } finally {
      if (exiting.current === "working") exiting.current = null;
    }
  }

  async function choose(
    team: JoinedTeam,
    targetDirectory?: JoinedTeams,
    signal?: AbortSignal,
    commit?: () => void,
  ): Promise<boolean> {
    const current = connection.current;
    if (!current || (!signal && selection.current) || signal?.aborted)
      return false;
    if (!signal) {
      selection.current = true;
      setChoosing(true);
    }
    try {
      return await enqueue(async () => {
        if (connection.current !== current || signal?.aborted) return false;
        readVersion.current++;
        const selected = commit ? await current.readJoinedTeams() : null;
        if (connection.current !== current || signal?.aborted) return false;
        const accepted =
          selected?.selectedTeam === team.id ||
          (await current.selectJoinedTeam(team.id));
        if (connection.current !== current || signal?.aborted) return false;
        if (accepted) {
          commit?.();
          setDirectory((previous) => {
            const source = selected ?? targetDirectory ?? previous;
            return source && { ...source, selectedTeam: team.id };
          });
          setPicker(false);
          if (systemPost && needsTeam === systemPost && !signal)
            setNeedsTeam(null);
          setNotice((previous) =>
            previous === "chooseFailed" ? null : previous,
          );
        } else {
          setNotice("chooseFailed");
        }
        try {
          await read(current);
        } catch {
          if (connection.current === current && !signal?.aborted)
            setNotice("storage");
        }
        return accepted;
      });
    } catch {
      if (connection.current === current && !signal?.aborted)
        setNotice("chooseFailed");
      return false;
    } finally {
      if (!signal) {
        selection.current = false;
        if (connection.current === current) setChoosing(false);
      }
    }
  }

  const { navigation: messages, dialog: messageDialog } = useMessageNavigation(
    connection.current,
    directory,
    online,
    language,
    sessionIssue,
    enqueue,
    choose,
  );
  const inspectSystem = useEffectEvent(
    async (request: SystemPostRequest, signal: AbortSignal) => {
      try {
        const route = await resumeChannelsLink({
          status: "sign_in_required",
          target: request.target,
        });
        signal.throwIfAborted();
        if (!route) {
          request.stop("unavailable");
          return;
        }
        if (route.status !== "ready" || route.userId !== userId) {
          sessionIssue("session");
          return;
        }
        if (!request.matchesUser(userId)) {
          request.stop("paused");
          return;
        }
        await messages.open(
          { kind: "post", id: request.target.postId },
          signal,
          {
            request,
            chooseTeam: () => {
              setNeedsTeam(request);
              setPicker(true);
            },
          },
        );
      } catch {
        if (!signal.aborted) request.stop("failed");
      }
    },
  );
  const handle = directory ? connection.current : null;
  useEffect(() => {
    if (
      !systemPost ||
      needsTeam === systemPost ||
      !handle ||
      systemPost.target.serverUrl !== serverUrl
    )
      return;
    const local = new AbortController();
    const signal = AbortSignal.any([local.signal, systemPost.signal]);
    void inspectSystem(systemPost, signal);
    return () => local.abort();
  }, [systemPost, handle, serverUrl, needsTeam]);
  const teams = directory?.teams ?? [];
  const selected = teams.find((team) => team.id === directory?.selectedTeam);
  const hasWorkspace = selected && connection.current && !picker;
  useWorkspaceBack(Boolean(messageDialog && !hasWorkspace), null);
  if (selected && connection.current && !picker) {
    return (
      <>
        {children({
          serverUrl,
          userId,
          team: selected,
          connection: connection.current,
          online,
          policy,
          sessionIssue,
          exit: { cleanup, run: runExit },
          directoryNotice: notice,
          directoryCode,
          chooseAnotherTeam: () => {
            messages.clear();
            setPicker(true);
          },
          messages,
          systemPost,
        })}
        {messageDialog}
      </>
    );
  }
  return (
    <EntryWindow>
      <h1>{text.title}</h1>
      <p className="entry-address" dir="ltr">
        {serverUrl}
      </p>
      {teams.length > 0 && (!systemPost || needsTeam === systemPost) && (
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
      {messageDialog}
      {directory && !teams.length && <p>{text.empty}</p>}
      {!notice && !directory && <p role="status">{text.loading}</p>}
      {notice && (
        <p role={notice === "offline" ? "status" : "alert"}>
          {text[notice]}
          {directoryCode && (
            <>
              {" "}
              <code dir="ltr">{directoryCode}</code>
            </>
          )}
        </p>
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
