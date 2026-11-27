import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { getDeviceLaunchContext } from "../mattermost/device-launch";
import {
  InstallationAddressError,
  inspectInstallation,
} from "../mattermost/inspect-installation";
import { EntryWindow } from "./EntryWindow";
import { type EntryLanguage, entryText } from "./language";
import { type SignInLink, SignInMethods } from "./SignInMethods";
import { sessionText } from "./session-text";
import "./connect.css";

type Profile = Awaited<ReturnType<typeof inspectInstallation>>;
type Issue =
  | InstallationAddressError["issue"]
  | "missing"
  | "network"
  | "storage";
type Step =
  | { name: "address"; issue?: Issue }
  | { name: "checking"; restoring: boolean }
  | { name: "profile"; profile: Profile };

export function ServerSignIn({
  language,
  savedServer,
  link,
  connect,
  onAccountChanged,
}: {
  language: EntryLanguage;
  savedServer?: string;
  link?: SignInLink;
  connect: (serverUrl: string, signal: AbortSignal) => Promise<void>;
  onAccountChanged: () => void;
}) {
  const text = entryText[language];
  const [address, setAddress] = useState(savedServer ?? "");
  const [step, setStep] = useState<Step>(
    savedServer ? { name: "checking", restoring: true } : { name: "address" },
  );
  const active = useRef<AbortController | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const returnToField = useRef(false);

  const inspect = useCallback(
    async (input: string, explicit: boolean) => {
      if (active.current) return;
      const request = new AbortController();
      active.current = request;
      setStep({ name: "checking", restoring: !explicit });
      let readingDevice = false;
      try {
        const profile = await inspectInstallation(input, request.signal);
        if (request.signal.aborted) return;
        if (explicit) {
          readingDevice = true;
          await connect(profile.serverUrl, request.signal);
          if (request.signal.aborted) return;
          const context = await getDeviceLaunchContext();
          if (request.signal.aborted) return;
          if (
            context.status !== "sign_in_required" ||
            context.serverUrl !== profile.serverUrl
          ) {
            onAccountChanged();
            return;
          }
        }
        setStep({ name: "profile", profile });
      } catch (error) {
        if (request.signal.aborted) return;
        const issue = readingDevice
          ? "storage"
          : error instanceof InstallationAddressError
            ? error.issue
            : error instanceof ResponseError && error.response.status === 404
              ? "missing"
              : "network";
        setStep({ name: "address", issue });
      } finally {
        if (active.current === request) active.current = null;
      }
    },
    [connect, onAccountChanged],
  );

  // The saved-server Back button must own the request from the first visible frame.
  useLayoutEffect(() => {
    if (savedServer) void inspect(savedServer, false);
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [savedServer, inspect]);
  useLayoutEffect(() => {
    if (step.name === "address" && (returnToField.current || step.issue)) {
      field.current?.focus();
      returnToField.current = false;
    }
  }, [step]);
  if (step.name === "profile") {
    return (
      <SignInMethods
        profile={step.profile}
        language={language}
        link={step.profile.serverUrl === savedServer ? link : undefined}
        onAccountChanged={onAccountChanged}
        onBack={() => {
          returnToField.current = true;
          setStep({ name: "address" });
        }}
      />
    );
  }
  const busy = step.name === "checking";
  const issue = step.name === "address" ? step.issue : undefined;
  const fieldIssue =
    issue && issue !== "network" && issue !== "missing" && issue !== "storage";
  return (
    <EntryWindow
      back={
        step.name === "checking" && step.restoring && !link
          ? {
              label: text.back,
              activate: () => {
                active.current?.abort();
                active.current = null;
                returnToField.current = true;
                setStep({ name: "address" });
              },
            }
          : undefined
      }
    >
      <h1>{text.title}</h1>
      <p className="entry-lead">{text.lead}</p>
      <form
        className="entry-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void inspect(address, true);
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
              {issue === "storage"
                ? sessionText[language].storage
                : text[issue]}
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
      {link && (
        <button
          className="entry-secondary entry-decline-link"
          type="button"
          onClick={link.dismiss}
        >
          {text.declineLink}
        </button>
      )}
    </EntryWindow>
  );
}
