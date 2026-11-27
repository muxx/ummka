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
import type { WorkspaceConnection } from "../channels/use-workspace-read.ts";
import { workspaceFailure } from "../channels/workspace-data.ts";
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
type Position = {
  request: Extract<TimelineRequest, { kind: "focus" }>;
  sidebar: TeamSidebar;
  membership: string;
  system?: SystemPostRequest;
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
  ) => Promise<void>;
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
    directory: JoinedTeams,
    signal: AbortSignal,
    commit: () => void,
  ) => Promise<boolean>,
) {
  const [position, setPosition] = useState<Position | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const current = useRef<AbortController | null>(null);
  const counter = useRef(0);
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
    current.current?.abort();
    current.current = null;
    returnFocus.current = null;
    setModal(null);
    setPosition(null);
  }, []);
  useLayoutEffect(() => {
    if (!connection) return;
    return () => current.current?.abort();
  }, [connection]);
  useEffect(() => {
    if (!online && current.current) clear();
  }, [online, clear]);
  async function open(
    source: Source,
    originSignal: AbortSignal,
    origin: HTMLElement | SystemOrigin,
  ) {
    const system = origin instanceof HTMLElement ? undefined : origin;
    if (!connection || !directory || originSignal.aborted) return;
    if (!online) {
      system?.request.stop("paused");
      return;
    }
    if (current.current) {
      if (!system) return;
      current.current.abort();
      setModal(null);
    }
    external.current = system?.request ?? null;
    const task = new AbortController(),
      { signal } = task;
    current.current = task;
    const abort = () => {
      task.abort();
      if (current.current === task) {
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
          requestId: ++counter.current,
          rid: connection.rid,
          teamId: team.id,
          post: target.post,
        },
        sidebar,
        membership: membershipDetail(),
        ...(system && { system: system.request }),
      };
      const selected = await enqueue(() => {
        signal.throwIfAborted();
        return connection.selectSidebarChannel(team.id, target.channelId);
      });
      signal.throwIfAborted();
      if (!selected) {
        error(text.missing);
        return;
      }
      function commit() {
        signal.throwIfAborted();
        setModal(null);
        system?.request.positioned();
        setPosition(destination);
      }
      if (!(await selectTeam(team, teams, signal, commit)) && !signal.aborted)
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
      if (current.current === task) current.current = null;
    }
  }
  return {
    navigation: {
      position,
      open,
      clear,
      enqueue,
      dialogOpen: Boolean(modal),
    } satisfies MessageNavigation,
    dialog: modal && <DestinationDialog modal={modal} language={language} />,
  };
}
