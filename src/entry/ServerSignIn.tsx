import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { isMobile } from "../build-platform";
import { useWorkspaceBack } from "../channels/use-workspace-back";
import { getDeviceLaunchContext } from "../mattermost/device-launch";
import {
  InstallationAddressError,
  inspectInstallation,
} from "../mattermost/inspect-installation";
import { EntryLinkOutcome } from "./EntryLinkOutcome";
import { EntryWindow } from "./EntryWindow";
import { type EntryLanguage, entryText } from "./language";
import { SavedServerPicker } from "./SavedServerPicker";
import {
  type SignedInPresentation,
  type SignInLink,
  SignInMethods,
} from "./SignInMethods";
import { sessionText } from "./session-text";
import type { EntryLinkResult } from "./use-system-permalink";
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
  | {
      name: "profile";
      profile: Profile;
      restored: boolean;
      picker?: Picker;
      returnFromPicker?: boolean;
    }
  | Picker;

export function ServerSignIn({
  language,
  savedServer,
  link,
  linkResult,
  installations,
  selectSaved,
  connect,
  onAccountChanged,
}: {
  language: EntryLanguage;
  savedServer?: string;
  link?: SignInLink;
  linkResult?: EntryLinkResult;
  installations?: readonly string[];
  selectSaved?: (serverUrl: string) => Promise<void>;
  connect: (serverUrl: string, signal: AbortSignal) => Promise<void>;
  onAccountChanged: (signedIn?: SignedInPresentation) => void;
}) {
  const text = entryText[language];
  const [address, setAddress] = useState(savedServer ?? "");
  const [step, setStep] = useState<Step>(
    savedServer ? { name: "checking", restoring: true } : { name: "address" },
  );
  const active = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const addressGroup = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const coldOutcome = useRef(!savedServer && linkResult !== undefined);
  const returnToField = useRef(false);
  const closeShownOutcome = useRef<(() => void) | undefined>(undefined);
  const closeOutcome = step.name === "servers" ? undefined : linkResult?.close;
  // An arrival that has not reached this form belongs on the next screen.
  useLayoutEffect(() => {
    closeShownOutcome.current = closeOutcome;
  }, [closeOutcome]);

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
          if (context.status !== "first_launch") closeShownOutcome.current?.();
          if (
            context.status === "ready" &&
            context.serverUrl === profile.serverUrl
          ) {
            onAccountChanged({
              serverUrl: context.serverUrl,
              userId: context.userId,
              siteName: profile.siteName.trim(),
            });
            return;
          }
          if (
            context.status !== "sign_in_required" ||
            context.serverUrl !== profile.serverUrl
          ) {
            onAccountChanged();
            return;
          }
          if (picker) {
            picker = {
              ...picker,
              profile,
              installations: context.installations,
            };
          }
        }
        setStep({ name: "profile", profile, restored: !explicit, picker });
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
    if (
      step.name === "address" &&
      (coldOutcome.current || returnToField.current || step.issue)
    ) {
      const focusHeading =
        isMobile && (coldOutcome.current || (step.picker && !step.issue));
      (focusHeading ? heading.current : field.current)?.focus({
        preventScroll: Boolean(focusHeading),
      });
      coldOutcome.current = false;
      returnToField.current = false;
    }
  }, [step]);
  const showAddressOutcome =
    linkResult !== undefined &&
    step.name !== "profile" &&
    step.name !== "servers";
  useLayoutEffect(() => {
    if (!isMobile || !showAddressOutcome) return;
    const group = addressGroup.current;
    const pane = group?.closest(".entry-pane");
    const body = pane?.closest(".entry-body");
    if (!group || !pane || !body) return;
    const keepAddressVisible = () => {
      if (
        field.current === document.activeElement &&
        Number.parseFloat(getComputedStyle(body).scrollPaddingBlockEnd) > 0
      ) {
        group.scrollIntoView({ block: "nearest" });
      }
    };
    keepAddressVisible();
    const observer = new ResizeObserver(keepAddressVisible);
    observer.observe(body);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [showAddressOutcome]);
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
        linkedUrl={link ? savedServer : undefined}
        focusAdd={step.focusAdd === true}
        onChoose={step.choose}
        onClose={() =>
          setStep({
            name: "profile",
            profile: step.profile,
            restored: true,
            picker: step,
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
    const savedInstallations = step.picker?.installations ?? installations;
    return (
      <SignInMethods
        profile={step.profile}
        language={language}
        link={profileLink}
        linkResult={linkResult}
        restored={step.restored}
        returnFromPicker={step.returnFromPicker}
        onOtherServer={
          selectSaved &&
          savedInstallations &&
          (profileLink ? savedInstallations.length > 1 : step.restored)
            ? () =>
                setStep({
                  name: "servers",
                  profile: step.profile,
                  installations: savedInstallations,
                  choose: selectSaved,
                })
            : undefined
        }
        onAccountChanged={(signedIn) => {
          closeShownOutcome.current?.();
          onAccountChanged(signedIn);
        }}
        onBack={
          step.restored
            ? undefined
            : () => {
                returnToField.current = true;
                setStep({ name: "address", picker: step.picker });
              }
        }
      />
    );
  }
  const busy = step.name === "checking";
  const issue = step.name === "address" ? step.issue : undefined;
  const fieldIssue =
    issue && issue !== "network" && issue !== "missing" && issue !== "storage";
  return (
    <EntryWindow
      notice={
        linkResult && (
          <EntryLinkOutcome
            language={language}
            result={linkResult}
            onClose={() => {
              (isMobile ? heading.current : field.current)?.focus({
                preventScroll: isMobile,
              });
            }}
          />
        )
      }
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
        tabIndex={-1}
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
        <div ref={addressGroup}>
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
