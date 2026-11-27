import { useLayoutEffect, useRef, useState } from "react";
import { isMobile } from "../build-platform";
import { useWorkspaceBack } from "../channels/use-workspace-back.ts";
import { EntryWindow } from "./EntryWindow";
import { type EntryLanguage, entryText } from "./language";

export function SavedServerPicker({
  installations,
  currentUrl,
  currentName,
  linkedUrl,
  language,
  focusAdd,
  onChoose,
  onAdd,
  onClose,
}: {
  installations: readonly string[];
  currentUrl: string;
  currentName: string;
  linkedUrl?: string;
  language: EntryLanguage;
  focusAdd: boolean;
  onChoose: (url: string) => Promise<void>;
  onAdd: () => void;
  onClose: () => void;
}) {
  const text = entryText[language];
  const heading = useRef<HTMLHeadingElement>(null);
  const current = useRef<HTMLButtonElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const selecting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    (focusAdd
      ? add.current
      : isMobile
        ? heading.current
        : current.current
    )?.focus({ preventScroll: !focusAdd && isMobile });
  }, [focusAdd]);

  function close() {
    if (!selecting.current) onClose();
  }
  useWorkspaceBack(false, close);

  async function choose(url: string) {
    if (selecting.current) return;
    if (url === currentUrl) {
      close();
      return;
    }
    selecting.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await onChoose(url);
    } catch {
      setFailed(true);
    } finally {
      selecting.current = false;
      setBusy(false);
    }
  }

  return (
    <EntryWindow
      back={busy ? undefined : { label: text.backToSignIn, activate: close }}
    >
      <h1 ref={heading} tabIndex={-1} className="entry-saved-servers-title">
        {text.savedServers}
      </h1>
      <p className="entry-lead">{text.savedServersLead}</p>
      <ul className="entry-saved-servers" aria-label={text.savedServers}>
        {installations.map((server) => {
          const url = new URL(server);
          const selected = server === currentUrl;
          const name = (selected && currentName.trim()) || url.host;
          return (
            <li key={server}>
              <button
                className="entry-saved-server"
                type="button"
                ref={selected ? current : undefined}
                aria-current={selected || undefined}
                aria-disabled={busy || undefined}
                onClick={() => void choose(server)}
              >
                <span className="entry-monogram" aria-hidden="true">
                  {Array.from(name)[0]}
                </span>
                <span className="entry-saved-server-copy">
                  <span className="entry-saved-server-name">
                    <strong>{name}</strong>
                    {selected && <small>{text.selectedServer}</small>}
                  </span>
                  <span
                    className="entry-saved-server-address"
                    dir="ltr"
                    title={server}
                  >
                    {url.host}
                    <strong>{server.slice(url.origin.length)}</strong>
                  </span>
                  {server === linkedUrl && (
                    <small>{text.linkWaitingForSignIn}</small>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {failed && (
        <p className="entry-error" role="alert">
          {text.selectServerError}
        </p>
      )}
      <button
        ref={add}
        className="entry-secondary entry-add-server"
        type="button"
        aria-disabled={busy || undefined}
        onClick={() => {
          if (!selecting.current) onAdd();
        }}
      >
        {text.addServer}
      </button>
    </EntryWindow>
  );
}
