import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { isMobile } from "../build-platform";
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
export type SignInLink = { deliveryId: string; dismiss: () => void };
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
  link,
  onBack,
  onAccountChanged,
}: {
  profile: Profile;
  language: EntryLanguage;
  link?: SignInLink;
  onBack: () => void;
  onAccountChanged: () => void;
}) {
  const text = entryText[language];
  const labels = sessionText[language];
  const address = new URL(profile.serverUrl);
  const name = profile.siteName.trim() || address.host;
  const gitlabOnly =
    !!link &&
    profile.ssoProviders.length === 1 &&
    profile.ssoProviders[0] === "gitlab" &&
    !profile.passwordIdentifiers.length &&
    !profile.guestMagicLink;
  const operation = useRef<Attempt | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const buttons = useRef<HTMLUListElement>(null);
  const returnTo = useRef<Provider | null>(null);
  const [waiting, setWaiting] = useState<Provider | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState("");
  const [cancelledDelivery, setCancelledDelivery] = useState<string>();
  const delivery = link?.deliveryId;
  const previousDelivery = useRef(delivery);
  const providerDescription = useId();
  useLayoutEffect(() => {
    const linked =
      delivery !== undefined || previousDelivery.current !== undefined;
    previousDelivery.current = delivery;
    const provider = returnTo.current;
    const button =
      !waiting && (provider || linked) && (!linked || !isMobile)
        ? buttons.current?.querySelector<HTMLButtonElement>(
            provider ? `button[data-provider="${provider}"]` : "button",
          )
        : null;
    (button ?? heading.current)?.focus({ preventScroll: linked && isMobile });
  }, [delivery, waiting]);
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
    setCancelledDelivery(undefined);
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
        const detail = explain(error, labels);
        setMessage(detail);
        if (!detail) setCancelledDelivery(previousDelivery.current);
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
      back={
        waiting
          ? { label: labels.cancel, activate: cancelCurrent }
          : link
            ? undefined
            : { label: text.back, activate: onBack }
      }
    >
      <div
        className={
          link ? "entry-identity entry-link-identity" : "entry-identity"
        }
      >
        <span className="entry-monogram" aria-hidden="true">
          {Array.from(name)[0]}
        </span>
        <div>
          {link ? (
            <strong className="entry-link-server">{name}</strong>
          ) : (
            <h1 ref={waiting ? undefined : heading} tabIndex={-1}>
              {name}
            </h1>
          )}
          <p className="entry-address" dir="ltr">
            {link ? (
              <>
                <svg
                  className="entry-link-lock"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <rect x="4" y="7" width="8" height="6" rx="1" />
                  <path d="M6 7V5a2 2 0 0 1 4 0v2" />
                </svg>
                {address.host}
                <strong>
                  {profile.serverUrl.slice(address.origin.length)}
                </strong>
              </>
            ) : (
              profile.serverUrl
            )}
          </p>
        </div>
      </div>
      {waiting ? (
        <>
          {link ? (
            <h1 className="entry-link-title" tabIndex={-1} ref={heading}>
              {labels.waiting}
            </h1>
          ) : (
            <h2 tabIndex={-1} ref={heading}>
              {labels.waiting}
            </h2>
          )}
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
          {link ? (
            <>
              {cancelledDelivery === delivery && (
                <p className="entry-link-status" role="status">
                  {text.linkCancelled}
                </p>
              )}
              <h1 className="entry-link-title" ref={heading} tabIndex={-1}>
                {text.linkTitle}
              </h1>
              <p className="entry-lead entry-link-lead">{text.linkLead}</p>
            </>
          ) : (
            <h2>{text.methods}</h2>
          )}
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
                    className={
                      gitlabOnly
                        ? "entry-primary entry-link-primary"
                        : link
                          ? "entry-link-provider"
                          : "entry-primary"
                    }
                    type="button"
                    data-provider={provider}
                    aria-label={
                      link && !gitlabOnly ? providerNames[provider] : undefined
                    }
                    aria-describedby={
                      gitlabOnly
                        ? providerDescription
                        : link
                          ? providerDescription + provider
                          : undefined
                    }
                    onClick={() => void start(provider)}
                  >
                    {link && provider === "gitlab" && (
                      <svg
                        className="entry-gitlab-mark"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="M21 14l-9 7l-9-7l3-11l3 7h6l3-7z" />
                      </svg>
                    )}
                    {gitlabOnly ? (
                      text.gitlabSignIn
                    ) : link ? (
                      <span className="entry-link-method">
                        <strong>{providerNames[provider]}</strong>
                        <small id={providerDescription + provider}>
                          {text.browserMethod}
                        </small>
                      </span>
                    ) : (
                      providerNames[provider]
                    )}
                  </button>
                </li>
              ))}
              {profile.guestMagicLink && <li>{text.guest}</li>}
            </ul>
          ) : (
            <p>{text.none}</p>
          )}
          {gitlabOnly && (
            <p id={providerDescription} className="entry-hint entry-link-hint">
              {text.browserHint}
            </p>
          )}
          {link && (
            <button
              className="entry-secondary entry-decline-link"
              type="button"
              onClick={link.dismiss}
            >
              {text.declineLink}
            </button>
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
