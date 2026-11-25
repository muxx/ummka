import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  cancelBrowserSignIn,
  signInWithBrowser,
} from "../mattermost/browser-sign-in";
import type { inspectInstallation } from "../mattermost/inspect-installation";
import { EntryWindow } from "./EntryWindow";
import { type EntryLanguage, entryText } from "./language";
import { sessionText } from "./session-text";

type Profile = Awaited<ReturnType<typeof inspectInstallation>>;
type Provider = Profile["ssoProviders"][number];
type Attempt = { id?: string; cancelling: boolean };
type Text = (typeof sessionText)[EntryLanguage];
const providerNames = {
  gitlab: "GitLab",
  google: "Google",
  office365: "Office 365",
  openid: "OpenID Connect",
  saml: "SAML",
} as const;

function explain(error: unknown, text: Text): string {
  if (!error || typeof error !== "object" || !("kind" in error))
    return text.exchange;
  if (error.kind === "browser" && "cause" in error) {
    if (error.cause === "unsupported") return text.unsupported;
    if (error.cause === "busy") return text.busy;
    if (error.cause === "cancelled") return "";
    return text.unavailable;
  }
  if (error.kind === "not_saved" && "revocation_confirmed" in error)
    return error.revocation_confirmed === true
      ? text.notSaved
      : text.unconfirmed;
  if (error.kind === "registry") return text.storage;
  if (
    error.kind === "server" &&
    "error" in error &&
    error.error &&
    typeof error.error === "object" &&
    "message" in error.error &&
    typeof error.error.message === "string" &&
    error.error.message.trim()
  )
    return error.error.message;
  return text.exchange;
}

export function SignInMethods({
  profile,
  language,
  onBack,
  onAccountChanged,
}: {
  profile: Profile;
  language: EntryLanguage;
  onBack: () => void;
  onAccountChanged: () => void;
}) {
  const text = entryText[language];
  const labels = sessionText[language];
  const name = profile.siteName.trim() || new URL(profile.serverUrl).host;
  const operation = useRef<Attempt | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const buttons = useRef<HTMLUListElement>(null);
  const returnTo = useRef<Provider | null>(null);
  const [waiting, setWaiting] = useState<Provider | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState("");
  useLayoutEffect(() => {
    const button =
      !waiting && returnTo.current
        ? buttons.current?.querySelector<HTMLButtonElement>(
            `button[data-provider="${returnTo.current}"]`,
          )
        : null;
    (button ?? heading.current)?.focus();
  }, [waiting]);
  useEffect(
    () => () => {
      const request = operation.current;
      operation.current = null;
      if (request?.id && !request.cancelling)
        void cancelBrowserSignIn(request.id).catch(() => {});
    },
    [],
  );

  async function cancel(request: Attempt) {
    request.cancelling = true;
    setCancelling(true);
    if (!request.id) return;
    try {
      await cancelBrowserSignIn(request.id);
    } catch {
      if (operation.current === request) {
        request.cancelling = false;
        setCancelling(false);
        setMessage(labels.unavailable);
      }
    }
  }
  async function start(provider: Provider) {
    if (operation.current) return;
    const request: Attempt = { cancelling: false };
    operation.current = request;
    returnTo.current = provider;
    setMessage("");
    setCancelling(false);
    setWaiting(provider);
    try {
      await signInWithBrowser(profile.serverUrl, provider, (id) => {
        request.id = id;
        if (operation.current !== request)
          void cancelBrowserSignIn(id).catch(() => {});
        else if (request.cancelling) void cancel(request);
      });
    } catch (error) {
      if (operation.current !== request) return;
      operation.current = null;
      if (
        typeof error === "object" &&
        error &&
        "kind" in error &&
        error.kind === "selection_changed"
      ) {
        onAccountChanged();
      } else {
        setMessage(explain(error, labels));
        setWaiting(null);
      }
      return;
    }
    if (operation.current === request) {
      operation.current = null;
      onAccountChanged();
    }
  }

  function cancelCurrent() {
    if (operation.current && !operation.current.cancelling)
      void cancel(operation.current);
  }
  return (
    <EntryWindow
      back={{
        label: waiting ? labels.cancel : text.back,
        activate: waiting ? cancelCurrent : onBack,
      }}
    >
      <div className="entry-identity">
        <span className="entry-monogram" aria-hidden="true">
          {Array.from(name)[0]}
        </span>
        <div>
          <h1 ref={waiting ? undefined : heading} tabIndex={-1}>
            {name}
          </h1>
          <p className="entry-address" dir="ltr">
            {profile.serverUrl}
          </p>
        </div>
      </div>
      {waiting ? (
        <>
          <h2 tabIndex={-1} ref={heading}>
            {labels.waiting}
          </h2>
          <p role="status">
            {cancelling ? labels.cancelling : providerNames[waiting]}
          </p>
          <button
            type="button"
            className="entry-secondary"
            aria-disabled={cancelling}
            onClick={cancelCurrent}
          >
            {labels.cancel}
          </button>
        </>
      ) : (
        <>
          <h2>{text.methods}</h2>
          {profile.passwordIdentifiers.length > 0 ||
          profile.ssoProviders.length > 0 ||
          profile.guestMagicLink ? (
            <ul className="entry-methods" ref={buttons}>
              {profile.passwordIdentifiers.length > 0 && (
                <li>{text.password}</li>
              )}
              {profile.ssoProviders.map((provider) => (
                <li key={provider}>
                  <button
                    className="entry-primary"
                    type="button"
                    data-provider={provider}
                    onClick={() => void start(provider)}
                  >
                    {providerNames[provider]}
                  </button>
                </li>
              ))}
              {profile.guestMagicLink && <li>{text.guest}</li>}
            </ul>
          ) : (
            <p>{text.none}</p>
          )}
        </>
      )}
      {message && (
        <p className="entry-error" role="alert">
          {message}
        </p>
      )}
    </EntryWindow>
  );
}
