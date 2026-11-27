import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { isMobile } from "../build-platform";
import { useWorkspaceBack } from "../channels/use-workspace-back";
import {
  cancelBrowserSignIn,
  signInWithBrowser,
} from "../mattermost/browser-sign-in";
import type { inspectInstallation } from "../mattermost/inspect-installation";
import { EntryLinkOutcome } from "./EntryLinkOutcome";
import { EntryWindow } from "./EntryWindow";
import { type EntryLanguage, entryText } from "./language";
import { sessionText } from "./session-text";
import type { EntryLinkResult } from "./use-system-permalink";

type Profile = Awaited<ReturnType<typeof inspectInstallation>>;
type Provider = Profile["ssoProviders"][number];
type Attempt = { id?: string; cancelling: boolean };
export type SignInLink = { deliveryId: string; dismiss: () => void };
export type SignedInPresentation = {
  serverUrl: string;
  userId: string;
  siteName: string;
};
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
  linkResult,
  restored,
  onOtherServer,
  returnFromPicker,
  onBack,
  onAccountChanged,
}: {
  profile: Profile;
  language: EntryLanguage;
  link?: SignInLink;
  linkResult?: EntryLinkResult;
  restored?: boolean;
  onOtherServer?: () => void;
  returnFromPicker?: boolean;
  onBack?: () => void;
  onAccountChanged: (signedIn?: SignedInPresentation) => void;
}) {
  const text = entryText[language];
  const labels = sessionText[language];
  const address = new URL(profile.serverUrl);
  const name = profile.siteName.trim() || address.host;
  const gitlabOnly =
    profile.ssoProviders.length === 1 &&
    profile.ssoProviders[0] === "gitlab" &&
    !profile.passwordIdentifiers.length &&
    !profile.guestMagicLink;
  const operation = useRef<Attempt | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const buttons = useRef<HTMLUListElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const otherServer = useRef<HTMLButtonElement>(null);
  const restoreOtherServer = useRef(returnFromPicker);
  const returnTo = useRef<Provider | null>(null);
  const [waiting, setWaiting] = useState<Provider | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState("");
  const [cancelled, setCancelled] = useState<{
    provider: Provider;
    delivery?: string;
  }>();
  const delivery = link?.deliveryId;
  const previousDelivery = useRef(delivery);
  const coldOutcome = useRef(linkResult !== undefined);
  const providerDescription = useId();
  useLayoutEffect(() => {
    const linked =
      delivery !== undefined || previousDelivery.current !== undefined;
    const initial = coldOutcome.current;
    coldOutcome.current = false;
    previousDelivery.current = delivery;
    if (restoreOtherServer.current) {
      restoreOtherServer.current = false;
      if (otherServer.current) {
        otherServer.current.focus();
        return;
      }
    }
    const provider = returnTo.current;
    const button =
      !waiting && (!isMobile || (provider && !linked && !initial))
        ? buttons.current?.querySelector<HTMLButtonElement>(
            provider ? `button[data-provider="${provider}"]` : "button",
          )
        : null;
    (button ?? heading.current)?.focus({ preventScroll: isMobile && !button });
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
    setCancelled(undefined);
    setCancelling(false);
    setWaiting(provider);
    let userId: string;
    try {
      userId = await signInWithBrowser(profile.serverUrl, provider, (id) => {
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
        if (!detail)
          setCancelled({ provider, delivery: previousDelivery.current });
        setWaiting(null);
      }
      return;
    }
    if (operation.current === request) {
      operation.current = null;
      onAccountChanged({
        userId,
        serverUrl: profile.serverUrl,
        siteName: profile.siteName.trim(),
      });
    }
  }

  function cancelCurrent() {
    if (operation.current && !operation.current.cancelling)
      void cancel(operation.current);
  }
  const back = waiting
    ? { label: labels.cancel, activate: cancelCurrent }
    : !link && onBack
      ? { label: text.back, activate: onBack }
      : undefined;
  useWorkspaceBack(false, back?.activate ?? null);
  return (
    <EntryWindow
      notice={
        linkResult && (
          <EntryLinkOutcome
            language={language}
            result={linkResult}
            server={{ url: profile.serverUrl, name: profile.siteName.trim() }}
            onClose={() => {
              const button = isMobile
                ? null
                : waiting
                  ? cancelling
                    ? null
                    : cancelButton.current
                  : buttons.current?.querySelector<HTMLButtonElement>("button");
              (button ?? heading.current)?.focus({ preventScroll: isMobile });
            }}
          />
        )
      }
      back={back}
    >
      <div
        className={
          link
            ? "entry-identity entry-link-identity"
            : "entry-identity entry-link-identity entry-ordinary-identity"
        }
      >
        <span className="entry-monogram" aria-hidden="true">
          {Array.from(name)[0]}
        </span>
        <div>
          <strong className="entry-link-server">{name}</strong>
          <p className="entry-address" dir="ltr" title={profile.serverUrl}>
            <svg
              className="entry-link-lock"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <rect x="4" y="7" width="8" height="6" rx="1" />
              <path d="M6 7V5a2 2 0 0 1 4 0v2" />
            </svg>
            {address.host}
            <strong>{profile.serverUrl.slice(address.origin.length)}</strong>
          </p>
        </div>
      </div>
      {waiting ? (
        <>
          <h1
            className={link ? "entry-link-title" : "entry-ordinary-title"}
            tabIndex={-1}
            ref={heading}
          >
            {labels.waiting}
          </h1>
          <p role="status">
            {cancelling ? labels.cancelling : providerNames[waiting]}
          </p>
          <button
            type="button"
            className="entry-secondary"
            ref={cancelButton}
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
              {cancelled && cancelled.delivery === delivery && (
                <p className="entry-link-status" role="status">
                  <strong>{text.linkCancelledTitle}</strong>
                  <span>{text.linkCancelled}</span>
                </p>
              )}
              <h1 className="entry-link-title" ref={heading} tabIndex={-1}>
                {text.linkTitle}
              </h1>
              <p className="entry-lead entry-link-lead">{text.linkLead}</p>
            </>
          ) : (
            <>
              {cancelled && cancelled.delivery === undefined && (
                <p className="entry-ordinary-cancelled" role="status">
                  {text.browserCancelled(providerNames[cancelled.provider])}
                </p>
              )}
              <h1 className="entry-ordinary-title" ref={heading} tabIndex={-1}>
                {restored ? text.restoreSignIn : text.methods}
              </h1>
              <p className="entry-lead entry-ordinary-lead">
                {restored ? text.restoreSignInLead : text.methodsLead}
              </p>
            </>
          )}
          {profile.passwordIdentifiers.length > 0 ||
          profile.ssoProviders.length > 0 ||
          profile.guestMagicLink ? (
            <ul
              className={link ? "entry-methods" : "entry-ordinary-methods"}
              ref={buttons}
            >
              {profile.passwordIdentifiers.length > 0 && (
                <li>
                  {link ? (
                    text.password
                  ) : (
                    <span className="entry-link-method entry-ordinary-unavailable">
                      <strong>{text.password}</strong>
                      <small>{text.methodUnavailable}</small>
                    </span>
                  )}
                </li>
              )}
              {profile.ssoProviders.map((provider) => (
                <li key={provider}>
                  <button
                    className={
                      gitlabOnly
                        ? "entry-primary entry-link-primary"
                        : "entry-link-provider"
                    }
                    type="button"
                    data-provider={provider}
                    aria-label={
                      gitlabOnly ? undefined : providerNames[provider]
                    }
                    aria-describedby={
                      gitlabOnly
                        ? providerDescription
                        : providerDescription + provider
                    }
                    onClick={() => void start(provider)}
                  >
                    {provider === "gitlab" && (
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
                    ) : (
                      <span className="entry-link-method">
                        <strong>{providerNames[provider]}</strong>
                        <small id={providerDescription + provider}>
                          {text.browserMethod}
                        </small>
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {profile.guestMagicLink && (
                <li>
                  {link ? (
                    text.guest
                  ) : (
                    <span className="entry-link-method entry-ordinary-unavailable">
                      <strong>{text.guest}</strong>
                      <small>{text.methodUnavailable}</small>
                    </span>
                  )}
                </li>
              )}
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
            <div className="entry-link-actions">
              <button
                className="entry-secondary entry-decline-link"
                type="button"
                onClick={link.dismiss}
              >
                {text.declineLink}
              </button>
              {onOtherServer && (
                <button
                  ref={otherServer}
                  className="entry-secondary"
                  type="button"
                  onClick={onOtherServer}
                >
                  {text.otherServer}
                </button>
              )}
            </div>
          )}
          {!link && (onOtherServer || onBack) && (
            <div className="entry-ordinary-actions">
              <button
                ref={onOtherServer ? otherServer : undefined}
                className="entry-secondary"
                type="button"
                onClick={onOtherServer ?? onBack}
              >
                {onOtherServer ? text.otherServer : text.cancel}
              </button>
            </div>
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
