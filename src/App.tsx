import { useCallback, useEffect, useMemo, useState } from "react";
import { ChannelsWorkspace } from "./channels/ChannelsWorkspace";
import { PublishedLinkNavigation } from "./channels/PublishedPostLink";
import { AccountTeamWindow } from "./entry/AccountTeamWindow";
import { EntryWindow } from "./entry/EntryWindow";
import type { EntryLanguage } from "./entry/language";
import { ServerSignIn } from "./entry/ServerSignIn";
import type { SignedInPresentation } from "./entry/SignInMethods";
import { sessionText } from "./entry/session-text";
import { useSystemPermalink } from "./entry/use-system-permalink";
import { getDeviceLaunchContext } from "./mattermost/device-launch";
import {
  createThreadReadCoordination,
  type ThreadReadCoordination,
} from "./mattermost/thread-read-coordination";
import "./entry/system-post-notice.css";

type Launch = Awaited<ReturnType<typeof getDeviceLaunchContext>>;
export function App({ language }: { language: EntryLanguage }) {
  const [threadReads] = useState(createThreadReadCoordination);
  const [entry, setEntry] = useState<{
    attempt: number;
    signedIn?: SignedInPresentation;
  }>({ attempt: 0 });
  const reopen = useCallback((signedIn?: SignedInPresentation) => {
    setEntry(({ attempt }) => ({ attempt: attempt + 1, signedIn }));
  }, []);
  const inbox = useSystemPermalink(language, reopen);
  if (!inbox.ready)
    return (
      <>
        <EntryWindow>
          <p role="status">{sessionText[language].opening}</p>
        </EntryWindow>
        {inbox.notice(false, false)}
      </>
    );
  return (
    <EntryRoute
      key={entry.attempt}
      language={language}
      reopen={reopen}
      inbox={inbox}
      signedIn={entry.signedIn}
      threadReads={threadReads}
    />
  );
}
function EntryRoute({
  language,
  reopen,
  inbox,
  signedIn,
  threadReads,
}: {
  language: EntryLanguage;
  reopen: (signedIn?: SignedInPresentation) => void;
  inbox: ReturnType<typeof useSystemPermalink>;
  signedIn?: SignedInPresentation;
  threadReads: ThreadReadCoordination;
}) {
  const [launch, setLaunch] = useState<Launch | "reading" | "failed">(
    "reading",
  );
  useEffect(() => {
    let active = true;
    getDeviceLaunchContext().then(
      (result) => {
        if (active) setLaunch(result);
      },
      () => {
        if (active) setLaunch("failed");
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const text = sessionText[language];
  const address =
    typeof launch === "object" && "serverUrl" in launch
      ? launch.serverUrl
      : null;
  const links = useMemo(
    () =>
      address
        ? {
            serverUrl: address,
            open: inbox.openPost,
            openBookmark: inbox.openBookmark,
          }
        : null,
    [address, inbox.openPost, inbox.openBookmark],
  );
  const request =
    inbox.request?.target.serverUrl === address ? inbox.request : undefined;
  const needsSignIn =
    typeof launch === "object" && launch.status === "sign_in_required";
  const signInLink = needsSignIn ? request : undefined;
  const opening =
    typeof launch === "object" &&
    launch.status === "ready" &&
    inbox.opening?.serverUrl === launch.serverUrl
      ? inbox.opening
      : undefined;
  const resultInEntry =
    launch === "reading" ||
    (typeof launch === "object" && launch.status !== "ready");
  const notice =
    signInLink || (resultInEntry && inbox.entryResult)
      ? null
      : inbox.notice(
          needsSignIn,
          Boolean(inbox.request && address && !request),
        );
  function screen() {
    if (launch === "reading")
      return (
        <EntryWindow>
          <p role="status">{text.opening}</p>
        </EntryWindow>
      );
    if (launch === "failed")
      return (
        <EntryWindow>
          <p role="alert">{text.storage}</p>
          <button
            className="entry-primary"
            type="button"
            onClick={() => reopen()}
          >
            {text.retry}
          </button>
        </EntryWindow>
      );
    if (launch.status === "ready") {
      const identity =
        signedIn?.serverUrl === launch.serverUrl &&
        signedIn.userId === launch.userId
          ? signedIn
          : undefined;
      return (
        <AccountTeamWindow
          serverUrl={launch.serverUrl}
          userId={launch.userId}
          language={language}
          threadReads={threadReads}
          onSessionEnded={reopen}
          systemPost={request}
          opening={opening}
          linkNotice={opening ? notice : null}
          siteName={identity?.siteName}
          deviceServers={{
            installations: launch.installations,
            select: inbox.selectSaved,
            restore: inbox.restoreSaved,
            connect: inbox.connect,
            changed: reopen,
          }}
        >
          {(workspace) => (
            <PublishedLinkNavigation.Provider value={links}>
              <ChannelsWorkspace
                key={JSON.stringify([
                  workspace.connection.rid,
                  workspace.team.id,
                ])}
                workspace={workspace}
                language={language}
              />
            </PublishedLinkNavigation.Provider>
          )}
        </AccountTeamWindow>
      );
    }
    return (
      <ServerSignIn
        connect={inbox.connect}
        language={language}
        savedServer={
          launch.status === "sign_in_required" ? launch.serverUrl : undefined
        }
        link={signInLink}
        linkResult={inbox.entryResult}
        installations={
          signInLink
            ? inbox.installations
            : launch.status === "sign_in_required"
              ? launch.installations
              : undefined
        }
        selectSaved={inbox.selectSaved}
        onAccountChanged={reopen}
      />
    );
  }
  return (
    <>
      {screen()}
      {opening ? null : notice}
    </>
  );
}
