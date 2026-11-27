import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { openPostNavigation } from "../channels/post-navigation.ts";
import type { TimelineRequest } from "../channels/timeline-reader.ts";
import type { TimelinePlace } from "../channels/timeline-viewport.ts";
import type { WorkspaceConnection } from "../channels/use-workspace-read.ts";
import { workspaceFailure } from "../channels/workspace-data.ts";
import { directoryProblem } from "../mattermost/account-directory-error.ts";
import type { JoinedTeam, JoinedTeams } from "../mattermost/joined-teams.ts";
import type { MembershipTarget } from "../mattermost/own-membership.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import type { EntryLanguage } from "./language.ts";

import type { SystemPostRequest } from "./use-system-permalink";

type SystemOrigin = { request: SystemPostRequest; chooseTeam: () => void };
type Source = Parameters<typeof openPostNavigation>[1];
type Consent = Parameters<Parameters<typeof openPostNavigation>[3]>[0];
type Outcome = Awaited<
  ReturnType<ReturnType<typeof openPostNavigation>["open"]>
>["target"];
export type SavedCollectionOrigin = {
  teamId: string;
  teamName: string;
  channelId: string | null;
  index: number;
  scroll: number;
  offset?: number;
  reading: TimelinePlace | null;
};
type SavedCollectionReturn = {
  rid: number;
  teamId: string;
  place?: Omit<SavedCollectionOrigin, "teamId" | "teamName"> & { id: string };
  unavailableChannel?: string;
};
type Selection = {
  channelId: string | null;
  fromTeam?: string;
};
type Position = {
  request: Extract<TimelineRequest, { kind: "focus" }>;
  sidebar: TeamSidebar;
  membership: string;
  system?: SystemPostRequest;
  saved?: SavedCollectionOrigin;
  savedRevoked?: { name: string; focusPost: boolean };
  choosingChannel?: boolean;
};
type Queue = <T>(work: () => Promise<T>) => Promise<T>;
type Modal =
  | { kind: "consent"; step: Consent; answer: (yes: boolean) => void }
  | { kind: "waiting" }
  | { kind: "error"; text: string; close: () => void };
const copy = {
  en: {
    private: "Join the private channel?",
    team: "Join the team?",
    join: "Join and open",
    cancel: "Cancel",
    ok: "OK",
    working: "Joining…",
    missing:
      "Message unavailable. It was deleted or you may not have access to its channel.",
    archived: "This message is outside the available history.",
    unattached: "This file is no longer attached to a message.",
    failed: "Couldn’t open the message. Try again.",
    savedReturnFailed: "Couldn’t return to saved messages. Try again.",
    unconfirmed: "The server hasn’t confirmed membership.",
    forbidden: "The server refused access.",
    joinedTeam: "You joined the team.",
    joinedChannel: "You joined the channel.",
    privateDetail: (name: string) =>
      `Members of ${name} will see that you joined.`,
  },
  ru: {
    private: "Вступить в закрытый канал?",
    team: "Вступить в команду?",
    join: "Вступить и открыть",
    cancel: "Отмена",
    ok: "Понятно",
    working: "Вступаем…",
    missing:
      "Сообщение недоступно. Его удалили, или у вас нет доступа к каналу, где оно было.",
    archived: "Сообщение за границей доступной истории.",
    unattached: "Этот файл больше не прикреплён к сообщению.",
    failed: "Не удалось открыть сообщение. Попробуйте ещё раз.",
    savedReturnFailed:
      "Не удалось вернуться к сохранённым. Попробуйте ещё раз.",
    unconfirmed: "Сервер не подтвердил вступление.",
    forbidden: "Сервер отказал в доступе.",
    joinedTeam: "Вы вступили в команду.",
    joinedChannel: "Вы вступили в канал.",
    privateDetail: (name: string) =>
      `Участники «${name}» увидят, что вы вступили.`,
  },
};
function failureMessage(target: Outcome, language: EntryLanguage) {
  const text = copy[language];
  switch (target.kind) {
    case "archived":
      return text.archived;
    case "unattachedFile":
      return text.unattached;
    case "unavailable":
      return text.missing;
    case "membershipUnconfirmed":
      return text.unconfirmed;
    case "membershipFailed":
      return target.result.kind === "refused"
        ? target.result.refusal.message || text.forbidden
        : text.unconfirmed;
    case "readFailed":
      return target.reason === "forbidden" ? text.forbidden : text.failed;
    default:
      return text.failed;
  }
}

function DestinationDialog({
  modal,
  language,
}: {
  modal: Modal;
  language: EntryLanguage;
}) {
  const node = useRef<HTMLDialogElement>(null),
    primary = useRef<HTMLButtonElement>(null),
    title = useId(),
    description = useId();
  const text = copy[language];
  useLayoutEffect(() => {
    const dialog = node.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  useLayoutEffect(() => {
    if (modal.kind !== "waiting") primary.current?.focus();
  }, [modal.kind]);
  const cancel = () => {
    if (modal.kind === "consent") modal.answer(false);
    if (modal.kind === "error") modal.close();
  };
  const step = modal.kind === "consent" ? modal.step : null;
  return (
    <dialog
      className="channels-search-dialog message-destination-dialog modal-layout"
      ref={node}
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.repeat) event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (event.target === node.current) {
          const bounds = node.current?.getBoundingClientRect();
          if (
            bounds &&
            (event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom)
          )
            cancel();
        }
      }}
    >
      <h2 id={title}>
        {step
          ? step.kind === "joinTeam"
            ? text.team
            : text.private
          : modal.kind === "waiting"
            ? text.working
            : language === "ru"
              ? "Переход к сообщению"
              : "Open message"}
      </h2>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users scroll this region even when it contains only text. */}
      <section className="modal-scroll" aria-labelledby={title} tabIndex={0}>
        <p id={description} role={modal.kind === "error" ? "alert" : "status"}>
          {step
            ? [
                step.team.displayName,
                step.channel.displayName,
                step.channel.kind === "P"
                  ? text.privateDetail(step.channel.displayName)
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : modal.kind === "error"
              ? modal.text
              : text.working}
        </p>
      </section>
      <footer>
        {modal.kind === "consent" && (
          <>
            <button type="button" onClick={() => modal.answer(false)}>
              {text.cancel}
            </button>
            <button
              ref={primary}
              type="button"
              onClick={() => modal.answer(true)}
            >
              {text.join}
            </button>
          </>
        )}
        {modal.kind === "error" && (
          <button
            type="button"
            ref={primary}
            aria-describedby={description}
            onClick={modal.close}
          >
            {text.ok}
          </button>
        )}
      </footer>
    </dialog>
  );
}

export type MessageNavigation = {
  dialogOpen: boolean;
  position: Position | null;
  open: (
    source: Source,
    signal: AbortSignal,
    origin: HTMLElement | SystemOrigin,
    saved?: SavedCollectionOrigin,
  ) => Promise<void>;
  savedReturn: SavedCollectionReturn | null;
  returnToSaved: (control: HTMLElement | null) => Promise<void>;
  endSaved: () => void;
  completeChannelChoice: (id: number, accepted: boolean) => void;
  closeSavedSurface: (teamId: string) => void;
  enqueue: Queue;
  clear: () => void;
};
export function useMessageNavigation(
  connection: WorkspaceConnection | null,
  directory: JoinedTeams | null,
  online: boolean,
  language: EntryLanguage,
  sessionIssue: (issue: "session" | "unauthorized") => void,
  enqueue: Queue,
  selectTeam: (
    team: JoinedTeam,
    signal: AbortSignal,
    commit: () => void,
    selection: Selection,
  ) => Promise<boolean>,
) {
  const [position, setPosition] = useState<Position | null>(null);
  const [savedReturn, setSavedReturn] = useState<SavedCollectionReturn | null>(
    null,
  );
  const [modal, setModal] = useState<Modal | null>(null);
  const current = useRef<{
    controller: AbortController;
    kind: "open" | "return";
  } | null>(null);
  const counter = useRef(0);
  const savedSurfaces = useRef(new Set<string>());
  const external = useRef<SystemPostRequest | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (modal || !returnFocus.current) return;
    if (returnFocus.current.isConnected)
      returnFocus.current.focus({ preventScroll: true });
    returnFocus.current = null;
  }, [modal]);
  const clear = useCallback(() => {
    external.current?.stop("paused");
    external.current = null;
    current.current?.controller.abort();
    current.current = null;
    returnFocus.current = null;
    setModal(null);
    setPosition(null);
    setSavedReturn(null);
  }, []);
  function captureTeamChange(teamId: string) {
    const previous = counter.current;
    return () => {
      if (counter.current === previous) clear();
      else {
        if (current.current?.kind === "return") {
          current.current.controller.abort();
          current.current = null;
        }
        setPosition((visible) => (visible === position ? null : visible));
      }
      setSavedReturn(
        connection && savedSurfaces.current.has(teamId)
          ? { rid: connection.rid, teamId }
          : null,
      );
    };
  }
  useLayoutEffect(() => {
    if (!connection) return;
    return () => {
      current.current?.controller.abort();
      savedSurfaces.current.clear();
    };
  }, [connection]);
  const revokeSaved = useCallback(
    (currentPosition: Position, activated: boolean) => {
      const saved = currentPosition.saved;
      if (!saved) return;
      const returning = current.current?.kind === "return";
      const inReturnBar = Boolean(
        document.activeElement?.closest(
          ".collection-result-steps[data-cross-team]",
        ),
      );
      if (returning) {
        current.current?.controller.abort();
        current.current = null;
      }
      savedSurfaces.current.delete(saved.teamId);
      setPosition((visible) => {
        if (visible?.request !== currentPosition.request || !visible.saved)
          return visible;
        const { saved: _saved, ...destination } = visible;
        return {
          ...destination,
          savedRevoked: {
            name: saved.teamName,
            focusPost: activated || returning || inReturnBar,
          },
        };
      });
    },
    [],
  );
  useLayoutEffect(() => {
    if (!directory) return;
    for (const id of savedSurfaces.current)
      if (!directory.teams.some((team) => team.id === id))
        savedSurfaces.current.delete(id);
    const source = position?.saved;
    if (source && !directory.teams.some(({ id }) => id === source.teamId))
      revokeSaved(position, false);
  }, [directory, position, revokeSaved]);
  useEffect(() => {
    if (online || !current.current) return;
    if (current.current.kind === "return") {
      current.current.controller.abort();
      current.current = null;
    } else clear();
  }, [online, clear]);
  function endSaved() {
    if (current.current?.kind === "return") {
      current.current.controller.abort();
      current.current = null;
    }
    setPosition((visible) => {
      if (!visible?.saved) return visible;
      const { saved: _saved, ...destination } = visible;
      return destination;
    });
  }
  async function open(
    source: Source,
    originSignal: AbortSignal,
    origin: HTMLElement | SystemOrigin,
    saved?: SavedCollectionOrigin,
  ) {
    const system = origin instanceof HTMLElement ? undefined : origin;
    if (!connection || !directory || originSignal.aborted) return;
    if (!online) {
      system?.request.stop("paused");
      return;
    }
    if (current.current) {
      if (!system) return;
      current.current.controller.abort();
      setModal(null);
    }
    const requestId = ++counter.current;
    external.current = system?.request ?? null;
    const task = new AbortController(),
      { signal } = task;
    current.current = { controller: task, kind: "open" };
    const abort = () => {
      task.abort();
      if (current.current?.controller === task) {
        current.current = null;
        setModal(null);
      }
    };
    originSignal.addEventListener("abort", abort, { once: true });
    const restore = () => {
      if (origin instanceof HTMLElement) returnFocus.current = origin;
      else origin.request.dismiss();
      setModal(null);
    };
    const text = copy[language];
    let joined: MembershipTarget[] = [];
    function membershipDetail() {
      return joined
        .map((row) =>
          row.kind === "team" ? text.joinedTeam : text.joinedChannel,
        )
        .join(" ");
    }
    function error(message: string) {
      setModal({
        kind: "error",
        text: [membershipDetail(), message].filter(Boolean).join(" "),
        close: restore,
      });
    }
    try {
      const confirm = (step: Consent) =>
        new Promise<boolean>((resolve) => {
          const onAbort = () => resolve(false);
          signal.addEventListener("abort", onAbort, { once: true });
          setModal({
            kind: "consent",
            step,
            answer: (yes) => {
              signal.removeEventListener("abort", onAbort);
              if (!signal.aborted && yes) setModal({ kind: "waiting" });
              resolve(yes);
            },
          });
        });
      // A previous manual or dismissed link may still be committing the account's team.
      // Resolve team-relative links against the resulting device selection.
      const sourceDirectory = system
        ? await enqueue(async () => {
            signal.throwIfAborted();
            return connection.readJoinedTeams();
          })
        : directory;
      signal.throwIfAborted();
      if (!sourceDirectory) {
        error(text.missing);
        return;
      }
      const result = await openPostNavigation(
        connection,
        source,
        sourceDirectory.selectedTeam,
        confirm,
        signal,
      ).open();
      signal.throwIfAborted();
      joined = result.joined;
      const target = result.target;
      if (target.kind !== "ready") {
        if (target.kind === "selectTeam" && system) {
          system.chooseTeam();
          return;
        }
        if (
          target.kind === "readFailed" &&
          target.reason !== "forbidden" &&
          system
        ) {
          setModal(null);
          system.request.stop("failed", membershipDetail());
          return;
        }
        if (target.kind === "cancelled") {
          restore();
        } else if (
          target.kind === "membershipFailed" &&
          target.result.kind === "unauthorized"
        ) {
          setModal(null);
          sessionIssue("unauthorized");
        } else error(failureMessage(target, language));
        return;
      }
      let teams = sourceDirectory;
      if (!teams.teams.some((row) => row.id === target.teamId)) {
        await connection.refreshJoinedTeams(signal);
        signal.throwIfAborted();
        const published = await connection.readJoinedTeams();
        signal.throwIfAborted();
        if (!published) {
          error(text.missing);
          return;
        }
        teams = published;
      }
      const team = teams.teams.find((row) => row.id === target.teamId);
      if (!team) {
        error(text.missing);
        return;
      }
      let sidebar = await connection.readTeamSidebar(team.id);
      signal.throwIfAborted();
      if (!sidebar?.data.channels.some((row) => row.id === target.channelId)) {
        await connection.refreshTeamSidebar(team.id, signal);
        signal.throwIfAborted();
        sidebar = await connection.readTeamSidebar(team.id);
        signal.throwIfAborted();
      }
      if (!sidebar?.data.channels.some((row) => row.id === target.channelId)) {
        error(text.missing);
        return;
      }
      const destination: Position = {
        request: {
          kind: "focus",
          requestId,
          rid: connection.rid,
          teamId: team.id,
          post: target.post,
        },
        sidebar,
        membership: membershipDetail(),
        ...(system && { system: system.request }),
        ...(saved &&
          !system &&
          saved.teamId !== team.id && { saved, choosingChannel: true }),
      };
      function commit() {
        signal.throwIfAborted();
        setModal(null);
        system?.request.positioned();
        savedSurfaces.current.delete(destination.request.teamId);
        if (destination.saved)
          savedSurfaces.current.add(destination.saved.teamId);
        setSavedReturn(null);
        setPosition(destination);
      }
      if (
        !(await selectTeam(team, signal, commit, {
          channelId: destination.choosingChannel ? null : target.channelId,
          fromTeam: saved?.teamId,
        })) &&
        !signal.aborted
      )
        error(text.failed);
    } catch (cause) {
      if (signal.aborted) return;
      const issue = workspaceFailure(cause, "network");
      if (issue === "session" || issue === "unauthorized") {
        setModal(null);
        sessionIssue(issue);
      } else if (system && issue !== "forbidden") {
        setModal(null);
        system.request.stop("failed", membershipDetail());
      } else error(issue === "forbidden" ? text.missing : text.failed);
    } finally {
      originSignal.removeEventListener("abort", abort);
      if (current.current?.controller === task) current.current = null;
    }
  }
  async function returnToSaved(control: HTMLElement | null) {
    const saved = position?.saved;
    if (!position || !saved || !connection || !online || current.current)
      return;
    const task = new AbortController();
    const { signal } = task;
    current.current = { controller: task, kind: "return" };
    counter.current++;
    const text = copy[language];
    const fromTeam = position.request.teamId;
    const sourceTeam = saved.teamId;
    function fail(message: string) {
      setModal({
        kind: "error",
        text: message,
        close: () => {
          if (control?.isConnected) returnFocus.current = control;
          setModal(null);
        },
      });
    }
    try {
      let refreshed: boolean;
      try {
        refreshed = await connection.refreshJoinedTeams(signal);
      } catch (cause) {
        if (signal.aborted) return;
        const problem = directoryProblem(cause);
        if (typeof problem === "string") sessionIssue(problem);
        else fail(text.savedReturnFailed);
        return;
      }
      signal.throwIfAborted();
      if (!refreshed) {
        fail(text.savedReturnFailed);
        return;
      }
      const teams = await connection.readJoinedTeams();
      signal.throwIfAborted();
      if (!teams) {
        fail(text.savedReturnFailed);
        return;
      }
      const team = teams.teams.find(({ id }) => id === sourceTeam);
      if (!team) {
        revokeSaved(position, true);
        return;
      }
      if (teams.selectedTeam !== fromTeam) return;
      let channelId = saved.channelId;
      if (channelId) {
        try {
          const refreshedSidebar = await connection.refreshTeamSidebar(
            team.id,
            signal,
          );
          signal.throwIfAborted();
          const sidebar = refreshedSidebar
            ? await connection.readTeamSidebar(team.id)
            : null;
          signal.throwIfAborted();
          if (!sidebar) {
            fail(text.savedReturnFailed);
            return;
          }
          if (!sidebar.data.channels.some(({ id }) => id === channelId))
            channelId = null;
        } catch (cause) {
          signal.throwIfAborted();
          if (workspaceFailure(cause, "network") !== "forbidden") throw cause;
          channelId = null;
        }
      }
      const accepted = await selectTeam(
        team,
        signal,
        () => {
          signal.throwIfAborted();
          setSavedReturn({
            rid: connection.rid,
            teamId: saved.teamId,
            ...(saved.channelId &&
              !channelId && { unavailableChannel: saved.channelId }),
            place: {
              channelId,
              reading: channelId ? saved.reading : null,
              scroll: saved.scroll,
              offset: saved.offset,
              id: position.request.post.id,
              index: saved.index,
            },
          });
          setPosition(null);
        },
        { channelId: null, fromTeam },
      );
      signal.throwIfAborted();
      if (!accepted) {
        const currentTeams = await connection.readJoinedTeams();
        signal.throwIfAborted();
        const revoked =
          currentTeams &&
          !currentTeams.teams.some(({ id }) => id === sourceTeam);
        if (revoked) revokeSaved(position, true);
        else fail(text.savedReturnFailed);
      }
    } catch (cause) {
      if (signal.aborted) return;
      const issue = workspaceFailure(cause, "network");
      if (issue === "session" || issue === "unauthorized") sessionIssue(issue);
      else fail(text.savedReturnFailed);
    } finally {
      if (current.current?.controller === task) current.current = null;
    }
  }
  return {
    navigation: {
      position,
      savedReturn,
      returnToSaved,
      endSaved,
      completeChannelChoice: (id, accepted) => {
        setPosition((visible) =>
          visible?.request.requestId === id
            ? accepted
              ? { ...visible, choosingChannel: false }
              : null
            : visible,
        );
      },
      closeSavedSurface: (teamId) => {
        savedSurfaces.current.delete(teamId);
      },
      open,
      clear,
      enqueue,
      dialogOpen: Boolean(modal),
    } satisfies MessageNavigation,
    captureTeamChange,
    dialog: modal && <DestinationDialog modal={modal} language={language} />,
  };
}
