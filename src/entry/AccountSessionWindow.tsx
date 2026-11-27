import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { workspaceCopy } from "../channels/workspace-copy";
import type { TeamWorkspace } from "./AccountTeamWindow";
import type { EntryLanguage } from "./language";
import { sessionText } from "./session-text";
import { signOutText } from "./sign-out-text";
import { teamText } from "./team-text";
import "./account-exit.css";

type Page = "account" | "confirm" | "unconfirmed" | "cleanup";

// Display known native codes. Transport and storage diagnostics stay private.
function cleanupCode(cause: unknown) {
  switch (cause) {
    case "credential_storage_unavailable":
    case "history_storage_unavailable":
    case "invalid_stored_credential":
      return cause;
  }
}

export function AccountSessionWindow({
  workspace,
  language,
  accountName,
  onDismiss,
}: {
  workspace: TeamWorkspace;
  language: EntryLanguage;
  accountName: string;
  onDismiss: () => void;
}) {
  const [page, setPage] = useState<Page>("account");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const working = useRef(false);
  const mounted = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const neutral = useRef<HTMLButtonElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const text = signOutText[language];
  const { cleanup, run } = workspace.exit;
  const code = cleanupCode(cleanup?.cause);
  const isMenu = page === "account";

  useLayoutEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    const target =
      page === "account"
        ? heading.current
        : page === "cleanup"
          ? primary.current
          : neutral.current;
    target?.focus({ preventScroll: true });
  }, [page]);

  async function signOut() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const next = await run(page === "confirm" ? "server" : "device");
      if (mounted.current && next) setPage(next);
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }

  const actions = {
    confirm: {
      secondary: text.cancel,
      primary: text.signOut,
      busy: text.pending,
      progress: text.pendingExplanation,
    },
    unconfirmed: {
      secondary: text.stay,
      primary: text.localOnly,
      busy: text.pendingLocal,
      progress: text.pendingLocalExplanation,
    },
    cleanup: {
      secondary: text.later,
      primary: text.retryLocal,
      busy: text.cleaning,
      progress: text.cleaningExplanation,
    },
  };
  return (
    <dialog
      ref={dialog}
      className={`${isMenu ? "workspace-account-menu" : "account-exit-window"} modal-layout`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!working.current) onDismiss();
      }}
    >
      <header>
        <h1 id={titleId} tabIndex={-1} ref={heading}>
          {isMenu
            ? workspace.team.displayName || workspace.team.name
            : text[page]}
        </h1>
        <button
          type="button"
          className="workspace-menu-close"
          aria-label={isMenu ? workspaceCopy[language].close : text.close}
          disabled={busy}
          onClick={onDismiss}
        >
          ×
        </button>
      </header>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users scroll this region even when it contains only text. */}
      <section className="modal-scroll" aria-labelledby={titleId} tabIndex={0}>
        {isMenu ? (
          <>
            <p className="entry-address" dir="ltr">
              {workspace.serverUrl}
            </p>
            {workspace.directoryNotice && (
              <p role="status">
                {teamText[language][workspace.directoryNotice]}
                {workspace.directoryCode && (
                  <>
                    {" "}
                    <code dir="ltr">{workspace.directoryCode}</code>
                  </>
                )}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="account-exit-who">
              {accountName || text.account} · <bdi>{workspace.serverUrl}</bdi>
            </p>
            {page === "confirm" && <p>{text.consequence}</p>}
            {page === "unconfirmed" && (
              <>
                <p>{text.sessionRemains}</p>
                <p>{text.choice}</p>
              </>
            )}
            {page === "cleanup" && (
              <>
                <p>
                  {cleanup?.confirmed && `${text.serverEnded} `}
                  {text.remaining}
                </p>
                {code && (
                  <p className="account-exit-code">{text.errorCode(code)}</p>
                )}
              </>
            )}
            {failed && (
              <p className="entry-error" role="alert">
                {text.error}
              </p>
            )}
            {busy && <p role="status">{actions[page].progress}</p>}
          </>
        )}
      </section>
      <footer className="entry-session-actions">
        {isMenu ? (
          <>
            <button
              className="entry-secondary"
              type="button"
              onClick={workspace.chooseAnotherTeam}
            >
              {sessionText[language].chooseTeam}
            </button>
            <button
              className="entry-secondary"
              type="button"
              onClick={() => setPage(cleanup ? "cleanup" : "confirm")}
            >
              {text.signOut}
            </button>
          </>
        ) : (
          <>
            <button
              ref={neutral}
              className="entry-secondary"
              type="button"
              disabled={busy}
              onClick={onDismiss}
            >
              {actions[page].secondary}
            </button>
            <button
              ref={primary}
              className={
                page === "cleanup" ? "entry-primary" : "account-exit-danger"
              }
              type="button"
              aria-disabled={busy}
              onClick={() => void signOut()}
            >
              {busy ? actions[page].busy : actions[page].primary}
            </button>
          </>
        )}
      </footer>
    </dialog>
  );
}
