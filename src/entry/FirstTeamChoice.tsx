import { type ReactNode, useId, useLayoutEffect, useRef } from "react";
import { isMobile } from "../build-platform";
import type { JoinedTeam } from "../mattermost/joined-teams";
import { EntryWindow } from "./EntryWindow";
import type { EntryLanguage } from "./language";
import { firstTeamText, teamText } from "./team-text";
import "./first-team-choice.css";

type Choice = { id: string; name: string };
export type FirstTeamSelection = Choice &
  (
    | { kind: "saving" }
    | { kind: "failed"; unavailable?: boolean; code?: string }
  );
type Notice = keyof Omit<
  (typeof teamText)["ru"],
  "title" | "loading" | "empty" | "retry"
>;

const symbols = {
  world:
    "M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18",
  lock: "M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0v3",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  alert: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM12 8v4m0 4h.01",
  refresh: "M20 7V3m0 4h-4M4 17v4m0-4h4m-3 3a9 9 0 0 0 15-4M19 4A9 9 0 0 0 4 8",
};

function Icon({ name }: { name: keyof typeof symbols }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={symbols[name]} />
    </svg>
  );
}

function IssueBanner({
  title,
  detail,
  code,
  retry,
}: {
  title: string;
  detail: string;
  code?: string;
  retry?: ReactNode;
}) {
  return (
    <div className="entry-team-error">
      <Icon name="alert" />
      <div className="entry-team-error-copy" role="alert">
        <strong>{title}</strong>
        <span>
          {detail}
          {code && (
            <>
              {" "}
              <code dir="ltr">{code}</code>
            </>
          )}
        </span>
      </div>
      {retry}
    </div>
  );
}

export function FirstTeamChoice({
  language,
  serverUrl,
  siteName,
  accountName,
  teams,
  loading,
  hasDirectory,
  notice,
  directoryCode,
  choice,
  reload,
  select,
  otherServer,
  restoreOtherServer,
}: {
  language: EntryLanguage;
  serverUrl: string;
  siteName?: string;
  accountName: string;
  teams: readonly JoinedTeam[];
  loading: boolean;
  hasDirectory: boolean;
  notice: Notice | null;
  directoryCode?: string;
  choice: FirstTeamSelection | null;
  reload: () => void;
  select: (team: JoinedTeam) => void;
  otherServer?: () => void;
  restoreOtherServer: boolean;
}) {
  const text = firstTeamText[language];
  const address = new URL(serverUrl);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const rows = useRef<HTMLUListElement>(null);
  const pending = useRef<HTMLButtonElement>(null);
  const retryRead = useRef<HTMLButtonElement>(null);
  const other = useRef<HTMLButtonElement>(null);
  const retryWrite = useRef<HTMLButtonElement>(null);
  const saving = choice?.kind === "saving" ? choice : null;
  const failure = choice?.kind === "failed" ? choice : null;
  const retryTeam =
    failure && !failure.unavailable
      ? teams.find((team) => team.id === failure.id)
      : undefined;
  const canRetryWrite = retryTeam !== undefined;
  const waiting = loading && teams.length === 0;
  const readIssue = notice && notice !== "offline" ? notice : null;
  const empty = hasDirectory && teams.length === 0 && !waiting && !readIssue;
  const hasRows = teams.length > 0;
  const state = saving
    ? "saving"
    : failure
      ? "save-failed"
      : hasRows
        ? "ready"
        : waiting
          ? "loading"
          : empty
            ? "empty"
            : "read-failed";

  useLayoutEffect(() => {
    const target =
      state === "empty" && restoreOtherServer
        ? other.current
        : state === "saving"
          ? pending.current
          : state === "save-failed"
            ? canRetryWrite
              ? retryWrite.current
              : heading.current
            : isMobile
              ? heading.current
              : state === "ready"
                ? rows.current?.querySelector("button")
                : retryRead.current;
    (target ?? heading.current)?.focus({
      preventScroll: !target || target === heading.current,
    });
  }, [state, canRetryWrite, restoreOtherServer]);

  return (
    <EntryWindow>
      <div className="entry-identity entry-link-identity entry-ordinary-identity entry-first-team-identity">
        <span className="entry-monogram" aria-hidden="true">
          {siteName ? Array.from(siteName)[0] : <Icon name="world" />}
        </span>
        <div>
          {siteName && (
            <strong className="entry-link-server">{siteName}</strong>
          )}
          <p className="entry-address" dir="ltr" title={serverUrl}>
            {address.protocol === "https:" && <Icon name="lock" />}
            {address.host}
            <strong>{serverUrl.slice(address.origin.length)}</strong>
          </p>
        </div>
      </div>
      <div className="entry-first-teams">
        {failure && (
          <IssueBanner
            title={text.saveFailed(failure.name)}
            detail={retryTeam ? text.saveDetail : text.unavailable}
            code={failure.code}
            retry={
              retryTeam && (
                <button
                  ref={retryWrite}
                  type="button"
                  className="entry-secondary entry-team-error-retry"
                  aria-label={text.retryTeam(failure.name)}
                  onClick={() => select(retryTeam)}
                >
                  <Icon name="refresh" />
                  {text.retry}
                </button>
              )
            }
          />
        )}
        {readIssue && !waiting && !failure && (
          <IssueBanner
            title={text.readFailed}
            detail={
              directoryCode?.endsWith(".http-403")
                ? text.refused
                : teamText[language][readIssue]
            }
            code={directoryCode}
            retry={
              <button
                ref={retryRead}
                type="button"
                className="entry-secondary entry-team-error-retry"
                disabled={saving !== null}
                onClick={reload}
              >
                <Icon name="refresh" />
                {text.retry}
              </button>
            }
          />
        )}
        <h1 id={headingId} tabIndex={-1} ref={heading}>
          {empty ? text.empty : teamText[language].title}
        </h1>
        <p className="entry-first-team-lead">
          {accountName ? (
            <>
              {text.signedInAs} <strong>{accountName}</strong>.
            </>
          ) : (
            text.signedIn
          )}
        </p>
        {waiting && (
          <p className="entry-team-wait" role="status">
            {text.loading}
          </p>
        )}
        {notice === "offline" && (
          <p className="entry-first-team-hint" role="status">
            {teamText[language].offline}
          </p>
        )}
        {empty && (
          <>
            <p className="entry-first-team-hint">{text.emptyDetail}</p>
            <div className="entry-empty-team-actions">
              <button
                ref={retryRead}
                type="button"
                className="entry-secondary entry-team-check"
                onClick={reload}
              >
                {text.checkAgain}
              </button>
              {otherServer && (
                <button
                  ref={other}
                  className="entry-secondary entry-team-check"
                  type="button"
                  onClick={otherServer}
                >
                  {text.otherServer}
                </button>
              )}
            </div>
          </>
        )}
        {hasRows && (
          <ul
            className="entry-first-team-options"
            ref={rows}
            aria-labelledby={headingId}
          >
            {teams.map((team) => {
              const name = team.displayName.trim() || team.name;
              const active = saving?.id === team.id;
              return (
                <li key={team.id}>
                  <button
                    type="button"
                    className="entry-first-team-option"
                    ref={active ? pending : undefined}
                    aria-labelledby={`${headingId}-${team.id}`}
                    aria-disabled={active || undefined}
                    aria-busy={active || undefined}
                    disabled={saving !== null && !active}
                    onClick={() => {
                      if (!saving) select(team);
                    }}
                  >
                    <Icon name="users" />
                    <span>
                      <strong id={`${headingId}-${team.id}`}>{name}</strong>
                      {siteName && <small>{siteName}</small>}
                      {active && (
                        <small className="entry-team-progress">
                          {text.opening}
                        </small>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {hasRows && (
          <p className="entry-team-wait" role="status">
            {saving && text.saving(saving.name)}
          </p>
        )}
      </div>
    </EntryWindow>
  );
}
