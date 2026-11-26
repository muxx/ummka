import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { readChannelDirectoryPage } from "../mattermost/channel-directory-page.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import { availableDirectoryCopy } from "./available-directory-copy.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { type WorkspaceRead, workspaceFailure } from "./workspace-data.ts";

export type DirectoryChannel = Awaited<
  ReturnType<typeof readChannelDirectoryPage>
>["items"][number];

export function DirectoryJoinDialog({
  account,
  channel,
  state,
  online,
  language,
  refresh,
  choose,
  close,
  sessionIssue,
}: {
  account: Pick<WorkspaceConnection, "changeOwnMembership">;
  channel: DirectoryChannel;
  state: WorkspaceRead<TeamSidebar>;
  online: boolean;
  language: EntryLanguage;
  refresh: () => void;
  choose: (id: string) => void;
  close: () => void;
  sessionIssue: (issue: "session" | "unauthorized") => void;
}) {
  const text = availableDirectoryCopy[language];
  const id = useId(),
    dialog = useRef<HTMLDialogElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<
    "confirm" | "sending" | "checking" | "unknown" | "absent" | "refused"
  >("confirm");
  const [reason, setReason] = useState<string | null>(null);
  const previous = useRef<WorkspaceRead<TeamSidebar> | null>(null),
    sending = useRef(false),
    live = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    const modal = dialog.current;
    modal?.showModal();
    primary.current?.focus({ preventScroll: true });
    return () => {
      live.current = false;
      modal?.close();
    };
  }, []);
  function check() {
    if (!online) return;
    previous.current = state;
    setPhase("checking");
    refresh();
  }
  useEffect(() => {
    if (
      phase !== "checking" ||
      !previous.current ||
      previous.current === state ||
      state.status === "loading" ||
      state.status === "refreshing"
    )
      return;
    previous.current = null;
    if (state.status !== "ready" || !state.value) {
      setPhase("unknown");
      return;
    }
    if (
      state.value.data.channels.some(
        (room) =>
          room.id === channel.id && room.kind === "O" && room.deleteAt === 0,
      )
    )
      choose(channel.id);
    else setPhase("absent");
  }, [state, phase, choose, channel.id]);
  async function join() {
    if (
      sending.current ||
      !online ||
      (phase !== "confirm" && phase !== "absent")
    )
      return;
    if (
      state.value?.data.channels.some(
        (room) =>
          room.id === channel.id && room.kind === "O" && room.deleteAt === 0,
      )
    ) {
      choose(channel.id);
      return;
    }
    sending.current = true;
    setPhase("sending");
    try {
      const result = await account.changeOwnMembership(
        { kind: "channel", id: channel.id },
        "join",
      );
      if (!live.current) return;
      if (result.kind === "applied") {
        check();
        return;
      }
      if (result.kind === "unauthorized") {
        sessionIssue("unauthorized");
        return;
      }
      if (result.kind === "refused") {
        setReason(result.refusal.message);
        setPhase("refused");
        return;
      }
      setPhase("unknown");
    } catch (error) {
      if (!live.current) return;
      const issue = workspaceFailure(error, "network");
      if (issue === "session" || issue === "unauthorized") sessionIssue(issue);
      else setPhase("unknown");
    } finally {
      sending.current = false;
    }
  }
  function detail(label: string, value: string | undefined) {
    if (!value) return "";
    return `${label}: ${value}${/[.!?…]$/.test(value) ? "" : "."}`;
  }
  const description = [
    text.channel(channel.displayName),
    detail(text.purpose, channel.purpose),
    detail(text.topic, channel.header),
    text.before,
  ]
    .filter(Boolean)
    .join(" ");
  const busy = phase === "sending" || phase === "checking";
  return (
    <dialog
      ref={dialog}
      className="directory-join-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (phase !== "sending") close();
      }}
    >
      <header>
        <h2 id={id}>{text.confirm}</h2>
        <button
          type="button"
          className="directory-join-close"
          aria-label={text.dismiss}
          disabled={phase === "sending"}
          onClick={close}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="directory-join-body">
        <p>{description}</p>
        {(phase === "sending" || phase === "checking") && (
          <p role="status">
            {phase === "sending" ? text.pending : text.checking}
          </p>
        )}
        {phase === "refused" && <p role="alert">{reason || text.refused}</p>}
        {phase === "unknown" && <p role="alert">{text.unknown}</p>}
        {phase === "absent" && <p role="status">{text.absent}</p>}
      </div>
      <footer>
        <button type="button" disabled={phase === "sending"} onClick={close}>
          {phase === "refused" ? text.close : text.cancel}
        </button>
        {phase === "unknown" ? (
          <button type="button" disabled={!online} onClick={check}>
            {text.read}
          </button>
        ) : (
          phase !== "refused" && (
            <button
              type="button"
              ref={primary}
              disabled={!online || busy}
              onClick={() => void join()}
            >
              {text.join}
            </button>
          )
        )}
      </footer>
    </dialog>
  );
}
