import { useId, useLayoutEffect, useRef, useState } from "react";
import { Chevron } from "../channels/ChannelsFrame";
import type { JoinedTeam } from "../mattermost/joined-teams";
import type { TeamWorkspace } from "./AccountTeamWindow";
import type { EntryLanguage } from "./language";
import { teamChoiceText } from "./team-choice-text";
import "./team-switch-dialog.css";

type Attempt = { team: JoinedTeam; status: "pending" | "refused" };

export function TeamSwitchDialog({
  workspace,
  address,
  accountName,
  language,
  onBack,
  onClose,
}: {
  workspace: TeamWorkspace;
  address: string;
  accountName: string;
  language: EntryLanguage;
  onBack?: () => void;
  onClose: () => void;
}) {
  const text = teamChoiceText[language];
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const currentRow = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const saving = useRef(false);
  const [attempt, setAttempt] = useState<Attempt>();
  const pending = attempt?.status === "pending";
  useLayoutEffect(() => {
    const node = dialog.current;
    node?.showModal();
    (currentRow.current ?? heading.current)?.focus({ preventScroll: true });
    return () => node?.close();
  }, []);

  async function select(team: JoinedTeam, row: HTMLButtonElement) {
    if (saving.current) return;
    if (team.id === workspace.team.id) {
      onClose();
      return;
    }
    saving.current = true;
    setAttempt({ team, status: "pending" });
    if (await workspace.teamChoice.select(team)) return;
    if (!dialog.current?.isConnected) return;
    saving.current = false;
    setAttempt({ team, status: "refused" });
    row.focus({ preventScroll: true });
  }

  const back = () => {
    if (!saving.current) (onBack ?? onClose)();
  };

  return (
    <dialog
      ref={dialog}
      className="team-switch-dialog modal-layout"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        back();
      }}
    >
      <header className="team-switch-header">
        {onBack && (
          <button
            className="team-switch-control"
            type="button"
            aria-label={text.back}
            disabled={pending}
            onClick={back}
          >
            <Chevron direction="back" />
          </button>
        )}
        <h2 id={title} ref={heading} tabIndex={-1}>
          {text.title}
        </h2>
        <button
          className="team-switch-control"
          type="button"
          aria-label={text.close}
          disabled={pending}
          onClick={() => {
            if (!saving.current) onClose();
          }}
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
      <div className="team-switch-body modal-scroll">
        <div className="team-switch-identity">
          <h3 dir="ltr">{address}</h3>
          {accountName && <p>{accountName}</p>}
        </div>
        {attempt && (
          <p className="team-switch-status" role={pending ? "status" : "alert"}>
            {pending
              ? text.saving(teamName(attempt.team))
              : text.refused(teamName(attempt.team), teamName(workspace.team))}
          </p>
        )}
        <ul className="team-switch-rows" aria-label={text.group(address)}>
          {workspace.teamChoice.teams.map((team) => {
            const current = team.id === workspace.team.id;
            const working = pending && team.id === attempt.team.id;
            return (
              <li key={team.id}>
                <button
                  type="button"
                  className="team-switch-row"
                  ref={current ? currentRow : undefined}
                  aria-label={teamName(team)}
                  aria-current={current || undefined}
                  data-surface={current ? "selected-row" : undefined}
                  aria-disabled={pending || undefined}
                  aria-busy={working || undefined}
                  aria-description={
                    working ? text.progress : current ? text.current : undefined
                  }
                  onClick={(event) => void select(team, event.currentTarget)}
                >
                  <svg
                    width="19"
                    height="19"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 21h18M5 21V7l8-4v18m0-12h6v12M9 9h.01M9 12h.01M9 15h.01M16 13h.01M16 16h.01" />
                  </svg>
                  <strong>{teamName(team)}</strong>
                  {working ? (
                    <small>{text.progress}</small>
                  ) : (
                    current && <small>{text.current}</small>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </dialog>
  );
}

const teamName = (team: JoinedTeam) => team.displayName.trim() || team.name;
