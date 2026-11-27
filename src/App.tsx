import { useCallback, useEffect, useState } from "react";
import { ChannelsWorkspace } from "./channels/ChannelsWorkspace";
import { AccountTeamWindow } from "./entry/AccountTeamWindow";
import { EntryWindow } from "./entry/EntryWindow";
import type { EntryLanguage } from "./entry/language";
import { ServerSignIn } from "./entry/ServerSignIn";
import { sessionText } from "./entry/session-text";
import { useSystemPermalink } from "./entry/use-system-permalink";
import { getDeviceLaunchContext } from "./mattermost/device-launch";
import "./entry/system-post-notice.css";

type Launch = Awaited<ReturnType<typeof getDeviceLaunchContext>>;
export function App({ language }: { language: EntryLanguage }) {
  const [attempt, setAttempt] = useState(0);
  const reopen = useCallback(() => setAttempt((previous) => previous + 1), []);
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
      key={attempt}
      language={language}
      reopen={reopen}
      inbox={inbox}
    />
  );
}
function EntryRoute({
  language,
  reopen,
  inbox,
}: {
  language: EntryLanguage;
  reopen: () => void;
  inbox: ReturnType<typeof useSystemPermalink>;
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
  const request =
    inbox.request?.target.serverUrl === address ? inbox.request : undefined;
  const needsSignIn =
    typeof launch === "object" && launch.status === "sign_in_required";
  const signInLink = needsSignIn ? request : undefined;
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
          <button className="entry-primary" type="button" onClick={reopen}>
            {text.retry}
          </button>
        </EntryWindow>
      );
    if (launch.status === "ready")
      return (
        <AccountTeamWindow
          serverUrl={launch.serverUrl}
          userId={launch.userId}
          language={language}
          onSessionEnded={reopen}
          systemPost={request}
        >
          {(workspace) => (
            <ChannelsWorkspace
              key={JSON.stringify([
                workspace.connection.rid,
                workspace.team.id,
              ])}
              workspace={workspace}
              language={language}
              onEnded={reopen}
            />
          )}
        </AccountTeamWindow>
      );
    return (
      <ServerSignIn
        connect={inbox.connect}
        language={language}
        savedServer={
          launch.status === "sign_in_required" ? launch.serverUrl : undefined
        }
        link={signInLink}
        linkResult={inbox.entryResult}
        installations={signInLink ? inbox.installations : undefined}
        selectSaved={inbox.selectSaved}
        onAccountChanged={reopen}
      />
    );
  }
  return (
    <>
      {screen()}
      {notice}
    </>
  );
}
