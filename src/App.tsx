import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ResponseError } from "../vendor/mattermost/index.js";
import { EntryWindow } from "./entry/EntryWindow";
import { type EntryLanguage, entryText } from "./entry/language";
import {
  InstallationAddressError,
  inspectInstallation,
} from "./mattermost/inspect-installation";
import "./entry/connect.css";

type Profile = Awaited<ReturnType<typeof inspectInstallation>>;
type Issue = InstallationAddressError["issue"] | "missing" | "network";
type Step =
  | { name: "address"; issue?: Issue }
  | { name: "checking" }
  | { name: "profile"; profile: Profile };

const providerNames = {
  gitlab: "GitLab",
  google: "Google",
  office365: "Office 365",
  openid: "OpenID Connect",
  saml: "SAML",
} as const;

export function App({ language }: { language: EntryLanguage }) {
  const text = entryText[language];
  const [address, setAddress] = useState("");
  const [step, setStep] = useState<Step>({ name: "address" });
  const field = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const active = useRef<AbortController | null>(null);
  const returnToField = useRef(false);
  useEffect(() => () => active.current?.abort(), []);
  useLayoutEffect(() => {
    if (step.name === "profile") heading.current?.focus();
    else if (step.name === "address" && (returnToField.current || step.issue)) {
      field.current?.focus();
      returnToField.current = false;
    }
  }, [step]);

  async function connect() {
    if (active.current) return;
    const request = new AbortController();
    active.current = request;
    setStep({ name: "checking" });
    try {
      const profile = await inspectInstallation(address, request.signal);
      if (!request.signal.aborted) setStep({ name: "profile", profile });
    } catch (error) {
      if (request.signal.aborted) return;
      const issue =
        error instanceof InstallationAddressError
          ? error.issue
          : error instanceof ResponseError && error.response.status === 404
            ? "missing"
            : "network";
      setStep({ name: "address", issue });
    } finally {
      active.current = null;
    }
  }

  if (step.name === "profile") {
    const { profile } = step;
    const name = profile.siteName.trim() || new URL(profile.serverUrl).host;
    const methods = [
      ...(profile.passwordIdentifiers.length ? [text.password] : []),
      ...profile.ssoProviders.map((provider) => providerNames[provider]),
      ...(profile.guestMagicLink ? [text.guest] : []),
    ];
    return (
      <EntryWindow
        back={{
          label: text.back,
          activate: () => {
            returnToField.current = true;
            setStep({ name: "address" });
          },
        }}
      >
        <div className="entry-identity">
          <span className="entry-monogram" aria-hidden="true">
            {Array.from(name)[0]}
          </span>
          <div>
            <h1 ref={heading} tabIndex={-1}>
              {name}
            </h1>
            <p className="entry-address" dir="ltr">
              {profile.serverUrl}
            </p>
          </div>
        </div>
        <h2>{text.methods}</h2>
        {methods.length ? (
          <ul className="entry-methods">
            {methods.map((method) => (
              <li key={method}>{method}</li>
            ))}
          </ul>
        ) : (
          <p>{text.none}</p>
        )}
      </EntryWindow>
    );
  }

  const busy = step.name === "checking";
  const issue = step.name === "address" ? step.issue : undefined;
  const fieldIssue = issue && issue !== "network" && issue !== "missing";
  return (
    <EntryWindow>
      <h1>{text.title}</h1>
      <p className="entry-lead">{text.lead}</p>
      <form
        className="entry-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <div>
          <label htmlFor="server-address">{text.address}</label>
          <input
            id="server-address"
            ref={field}
            type="url"
            name="url"
            dir="ltr"
            autoComplete="url"
            inputMode="url"
            enterKeyHint="go"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="chat.example.org/mattermost"
            value={address}
            readOnly={busy}
            aria-invalid={fieldIssue || undefined}
            aria-describedby={issue ? "entry-hint entry-error" : "entry-hint"}
            onChange={(event) => {
              setAddress(event.target.value);
              if (issue) setStep({ name: "address" });
            }}
          />
          <p id="entry-hint" className="entry-hint">
            {text.hint}
          </p>
          {issue && (
            <p id="entry-error" className="entry-error" role="alert">
              {text[issue]}
            </p>
          )}
        </div>
        <button
          className="entry-primary"
          type="submit"
          aria-disabled={busy}
          aria-live="polite"
        >
          {busy ? text.busy : text.go}
        </button>
      </form>
    </EntryWindow>
  );
}
