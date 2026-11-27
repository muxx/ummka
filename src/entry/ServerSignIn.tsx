import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { isMobile } from "../build-platform";
import { useWorkspaceBack } from "../channels/use-workspace-back";
import { getDeviceLaunchContext } from "../mattermost/device-launch";
import {
  InstallationAddressError,
  inspectInstallation,
} from "../mattermost/inspect-installation";
import { EntryWindow } from "./EntryWindow";
import { type EntryLanguage, entryText } from "./language";
import { SavedServerPicker } from "./SavedServerPicker";
import { type SignInLink, SignInMethods } from "./SignInMethods";
import { sessionText } from "./session-text";
import "./connect.css";

type Profile = Awaited<ReturnType<typeof inspectInstallation>>;
type Issue =
  | InstallationAddressError["issue"]
  | "missing"
  | "network"
  | "storage";
type Picker = {
  name: "servers";
  profile: Profile;
  installations: readonly string[];
  choose: (serverUrl: string) => Promise<void>;
  focusAdd?: boolean;
};
type Step =
  | { name: "address"; issue?: Issue; picker?: Picker }
  | { name: "checking"; restoring: boolean; picker?: Picker }
  | { name: "profile"; profile: Profile; returnFromPicker?: boolean }
  | Picker;

export function ServerSignIn({
  language,
  savedServer,
  link,
  installations,
  selectSaved,
  connect,
  onAccountChanged,
}: {
  language: EntryLanguage;
  savedServer?: string;
  link?: SignInLink;
  installations?: readonly string[];
  selectSaved?: (serverUrl: string) => Promise<void>;
  connect: (serverUrl: string, signal: AbortSignal) => Promise<void>;
  onAccountChanged: () => void;
}) {
  const text = entryText[language];
  const [address, setAddress] = useState(savedServer ?? "");
  const [step, setStep] = useState<Step>(
    savedServer ? { name: "checking", restoring: true } : { name: "address" },
  );
  const active = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const returnToField = useRef(false);

  const inspect = useCallback(
    async (input: string, explicit: boolean, picker?: Picker) => {
      if (active.current) return;
      const request = new AbortController();
      active.current = request;
      setStep({ name: "checking", restoring: !explicit, picker });
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
        setStep({ name: "address", issue, picker });
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
      const focusHeading = isMobile && step.picker && !step.issue;
      (focusHeading ? heading.current : field.current)?.focus({
        preventScroll: Boolean(focusHeading),
      });
      returnToField.current = false;
    }
  }, [step]);
  const picker = "picker" in step ? step.picker : undefined;
  const backToServers =
    step.name === "address" && picker
      ? () => setStep({ ...picker, focusAdd: true })
      : null;
  useWorkspaceBack(false, backToServers);
  if (step.name === "servers") {
    return (
      <SavedServerPicker
        language={language}
        currentUrl={step.profile.serverUrl}
        currentName={step.profile.siteName}
        installations={step.installations}
        linkedUrl={savedServer}
        focusAdd={step.focusAdd === true}
        onChoose={step.choose}
        onClose={() =>
          setStep({
            name: "profile",
            profile: step.profile,
            returnFromPicker: true,
          })
        }
        onAdd={() => {
          setAddress("");
          returnToField.current = true;
          setStep({ name: "address", picker: step });
        }}
      />
    );
  }
  if (step.name === "profile") {
    const profileLink =
      step.profile.serverUrl === savedServer ? link : undefined;
    return (
      <SignInMethods
        profile={step.profile}
        language={language}
        link={profileLink}
        returnFromPicker={step.returnFromPicker}
        onOtherServer={
          profileLink &&
          selectSaved &&
          installations &&
          installations.length > 1
            ? () =>
                setStep({
                  name: "servers",
                  profile: step.profile,
                  installations,
                  choose: selectSaved,
                })
            : undefined
        }
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
          : backToServers
            ? { label: text.backToServers, activate: backToServers }
            : undefined
      }
    >
      <h1
        className={picker ? "entry-address-title" : undefined}
        ref={heading}
        tabIndex={picker ? -1 : undefined}
      >
        {text.title}
      </h1>
      <p className="entry-lead">{text.lead}</p>
      <form
        className="entry-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void inspect(address, true, picker);
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
              if (issue) setStep({ name: "address", picker });
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
      {link && !picker && (
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
