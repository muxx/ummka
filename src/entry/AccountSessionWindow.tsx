import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { workspaceCopy } from "../channels/workspace-copy";
import type { TeamWorkspace } from "./AccountTeamWindow";
import type { EntryLanguage } from "./language";
import { sessionText } from "./session-text";
import { signOutText } from "./sign-out-text";
import { teamText } from "./team-text";

type Page = "account" | "unconfirmed" | "confirmed";
export function AccountSessionWindow({
  workspace,
  language,
  onEnded,
  onDismiss,
}: {
  workspace: TeamWorkspace;
  language: EntryLanguage;
  onEnded: () => void;
  onDismiss: () => void;
}) {
  const [page, setPage] = useState<Page>("account");
  const [busy, setBusy] = useState<"server" | "local" | null>(null);
  const [failed, setFailed] = useState(false);
  const working = useRef(false);
  const mounted = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const signOutButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const text = signOutText[language];
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (page === "account" && restoreFocus.current) {
      signOutButton.current?.focus();
      restoreFocus.current = false;
    } else heading.current?.focus();
  }, [page]);

  async function signOut(local: boolean) {
    if (working.current) return;
    working.current = true;
    setBusy(local ? "local" : "server");
    setFailed(false);
    try {
      if (local) {
        await workspace.connection.signOutOnDevice();
        if (mounted.current) onEnded();
        return;
      }
      const result = await workspace.connection.signOut();
      if (!mounted.current) return;
      if (result.status === "unconfirmed") setPage("unconfirmed");
      else if (result.status === "server_confirmed_local_removal_failed")
        setPage("confirmed");
      else onEnded();
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current) {
        working.current = false;
        setBusy(null);
      }
    }
  }
  function stay() {
    if (working.current) return;
    restoreFocus.current = true;
    setFailed(false);
    setPage("account");
  }
  return (
    <dialog
      ref={dialog}
      className="workspace-account-menu modal-layout"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (page === "account" && !working.current) onDismiss();
      }}
    >
      <header>
        {page === "account" && (
          <button
            type="button"
            className="workspace-menu-close"
            aria-label={workspaceCopy[language].close}
            disabled={!!busy}
            onClick={onDismiss}
          >
            ×
          </button>
        )}
        <h1 id={titleId} tabIndex={-1} ref={heading}>
          {page === "account"
            ? workspace.team.displayName || workspace.team.name
            : text[page]}
        </h1>
      </header>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users scroll this region even when it contains only text. */}
      <section className="modal-scroll" aria-labelledby={titleId} tabIndex={0}>
        <p className="entry-address" dir="ltr">
          {workspace.serverUrl}
        </p>
        {page === "account" && workspace.directoryNotice && (
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
        {page !== "account" && (
          <p className="entry-lead">
            {page === "confirmed" ? text.remaining : text.explain}
          </p>
        )}
        {failed && (
          <p className="entry-error" role="alert">
            {text.error}
          </p>
        )}
        {busy && (
          <p role="status">
            {busy === "server" ? text.pending : text.pendingLocal}
          </p>
        )}
      </section>
      <footer className="entry-session-actions">
        {page === "account" ? (
          <>
            <button
              className="entry-secondary"
              type="button"
              disabled={!!busy}
              onClick={workspace.chooseAnotherTeam}
            >
              {sessionText[language].chooseTeam}
            </button>
            <button
              ref={signOutButton}
              className="entry-secondary"
              type="button"
              aria-disabled={!!busy}
              onClick={() => void signOut(false)}
            >
              {text.signOut}
            </button>
          </>
        ) : (
          <>
            {page === "unconfirmed" && (
              <button
                className="entry-secondary"
                type="button"
                disabled={!!busy}
                onClick={stay}
              >
                {text.stay}
              </button>
            )}
            <button
              className="entry-primary"
              type="button"
              aria-disabled={!!busy}
              onClick={() => void signOut(true)}
            >
              {page === "confirmed" ? text.retryLocal : text.localOnly}
            </button>
          </>
        )}
      </footer>
    </dialog>
  );
}
