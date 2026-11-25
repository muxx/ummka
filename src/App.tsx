import { useCallback, useEffect, useState } from "react";
import { ChannelsWorkspace } from "./channels/ChannelsWorkspace";
import { AccountTeamWindow } from "./entry/AccountTeamWindow";
import { EntryWindow } from "./entry/EntryWindow";
import type { EntryLanguage } from "./entry/language";
import { ServerSignIn } from "./entry/ServerSignIn";
import { sessionText } from "./entry/session-text";
import { getDeviceLaunchContext } from "./mattermost/device-launch";

type Launch = Awaited<ReturnType<typeof getDeviceLaunchContext>>;
export function App({ language }: { language: EntryLanguage }) {
  const [attempt, setAttempt] = useState(0);
  const reopen = useCallback(() => setAttempt((previous) => previous + 1), []);
  return <EntryRoute key={attempt} language={language} reopen={reopen} />;
}
function EntryRoute({
  language,
  reopen,
}: {
  language: EntryLanguage;
  reopen: () => void;
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
      >
        {(workspace) => (
          <ChannelsWorkspace
            key={JSON.stringify([workspace.connection.rid, workspace.team.id])}
            workspace={workspace}
            language={language}
            onEnded={reopen}
          />
        )}
      </AccountTeamWindow>
    );
  return (
    <ServerSignIn
      language={language}
      savedServer={
        launch.status === "sign_in_required" ? launch.serverUrl : undefined
      }
      onAccountChanged={reopen}
    />
  );
}
