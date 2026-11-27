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
import { FirstTeamChoice, type FirstTeamSelection } from "./FirstTeamChoice";
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
  teamChoice: {
    teams: readonly JoinedTeam[];
    select: (team: JoinedTeam) => Promise<boolean>;
  };
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
  siteName?: string;
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
type TeamChoiceRequest =
  | { kind: "workspace"; onAccepted: () => void }
  | { kind: "first"; onAccepted: () => void }
  | {
      kind: "message";
      directory: JoinedTeams;
      signal: AbortSignal;
      onAccepted: () => void;
    };
function issueOf(notice: Notice) {
  return typeof notice === "object" ? (notice?.issue ?? null) : notice;
}

function AccountWindow({
  serverUrl,
  userId,
  siteName,
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
  const [firstChoice, setFirstChoice] = useState<FirstTeamSelection | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [accountName, setAccountName] = useState("");
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
  const ordinaryChoice = useEffectEvent(() => !systemPost);
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
      setFirstChoice(null);
      setLoading(true);
      setAccountName("");
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
          setLoading(false);
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
        } else {
          setNotice({ issue: "storage", code: problem.code });
          setLoading(false);
        }
        return;
      }
      if (signal.aborted) return;
      if (!initial?.selectedTeam && ordinaryChoice())
        void readAccountName(acquired);
      await refresh();
    }
    async function readAccountName(current: Connection) {
      try {
        const saved = await current.readSavedProfiles({
          ids: [userId],
          usernames: [],
        });
        const profile = saved.profiles[userId];
        if (
          !signal.aborted &&
          connection.current === current &&
          profile?.id === userId
        )
          setAccountName(
            [profile.firstName.trim(), profile.lastName.trim()]
              .filter(Boolean)
              .join(" "),
          );
      } catch (cause) {
        if (!signal.aborted && connection.current === current) {
          const problem = directoryProblem(cause);
          if (typeof problem === "string") invalidation.current?.(problem);
        }
      }
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
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        await refreshOnline(active);
      } finally {
        if (active()) setLoading(false);
      }
    }
    async function refreshOnline(active: () => boolean) {
      if (!acquired) return;
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
            initial = published;
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
    request?: TeamChoiceRequest,
  ): Promise<boolean> {
    const message = request?.kind === "message" ? request : undefined;
    const signal = message?.signal;
    const first = request?.kind === "first";
    const reportFailure = !first && request?.kind !== "workspace";
    const current = connection.current;
    if (!current || (!signal && selection.current) || signal?.aborted)
      return false;
    if (!signal) {
      selection.current = true;
      setChoosing(true);
    }
    const choice = { id: team.id, name: team.displayName.trim() || team.name };
    let failure: FirstTeamSelection | null = null;
    if (first) setFirstChoice({ ...choice, kind: "saving" });
    try {
      return await enqueue(async () => {
        if (connection.current !== current || signal?.aborted) return false;
        readVersion.current++;
        const selected = message ? await current.readJoinedTeams() : null;
        if (connection.current !== current || signal?.aborted) return false;
        const accepted =
          selected?.selectedTeam === team.id ||
          (await (first
            ? atDirectoryStep("select", () => current.selectJoinedTeam(team.id))
            : current.selectJoinedTeam(team.id)));
        if (connection.current !== current || signal?.aborted) return false;
        if (accepted) {
          // Resolve the previous navigation before the next queued write can run.
          request?.onAccepted();
          setDirectory((previous) => {
            const source = selected ?? message?.directory ?? previous;
            return source && { ...source, selectedTeam: team.id };
          });
          setPicker(false);
          if (systemPost && needsTeam === systemPost && !signal)
            setNeedsTeam(null);
          setNotice((previous) =>
            previous === "chooseFailed" ? null : previous,
          );
        } else if (first) {
          failure = { ...choice, kind: "failed", unavailable: true };
        } else if (reportFailure) {
          setNotice("chooseFailed");
        }
        if (!accepted && !reportFailure && !first) return false;
        try {
          await read(current);
        } catch (cause) {
          if (connection.current === current && !signal?.aborted) {
            if (first) {
              const problem = directoryProblem(cause);
              if (typeof problem === "string") {
                sessionIssue(problem);
                return false;
              }
              setNotice({ issue: "storage", code: problem.code });
            } else setNotice("storage");
          }
        }
        return accepted;
      });
    } catch (cause) {
      if (connection.current !== current || signal?.aborted) return false;
      if (first) {
        const problem = directoryProblem(cause);
        if (typeof problem === "string") sessionIssue(problem);
        else failure = { ...choice, kind: "failed", code: problem.code };
      } else if (reportFailure) {
        setNotice("chooseFailed");
      }
      return false;
    } finally {
      if (!signal) {
        selection.current = false;
        if (connection.current === current) {
          setChoosing(false);
          if (first) setFirstChoice(failure);
        }
      }
    }
  }

  const {
    navigation: messages,
    dialog: messageDialog,
    captureTeamChange,
  } = useMessageNavigation(
    connection.current,
    directory,
    online,
    language,
    sessionIssue,
    enqueue,
    (team, directory, signal, onAccepted) =>
      choose(team, { kind: "message", directory, signal, onAccepted }),
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
          teamChoice: {
            teams: orderJoinedTeams(teams, language),
            select: (team) =>
              choose(team, {
                kind: "workspace",
                onAccepted: captureTeamChange(),
              }),
          },
          messages,
          systemPost,
        })}
        {messageDialog}
      </>
    );
  }
  if (!systemPost && !picker) {
    return (
      <FirstTeamChoice
        language={language}
        serverUrl={serverUrl}
        siteName={siteName}
        accountName={accountName}
        teams={orderJoinedTeams(teams, language)}
        loading={loading}
        hasDirectory={directory !== null}
        notice={notice}
        directoryCode={directoryCode}
        choice={firstChoice}
        reload={() => (retryRemoval.current ?? retry)()}
        select={(team) =>
          void choose(team, {
            kind: "first",
            onAccepted: captureTeamChange(),
          })
        }
      />
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
