import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AccountTeamWindow,
  type TeamWorkspace,
} from "./entry/AccountTeamWindow";
import { EntryWindow } from "./entry/EntryWindow";
import type { EntryLanguage } from "./entry/language";
import { ServerSignIn } from "./entry/ServerSignIn";
import { sessionText } from "./entry/session-text";
import { teamText } from "./entry/team-text";
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
          <AccountTeamSummary
            key={workspace.team.id}
            workspace={workspace}
            language={language}
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

function AccountTeamSummary({
  workspace,
  language,
}: {
  workspace: TeamWorkspace;
  language: EntryLanguage;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => heading.current?.focus(), []);
  return (
    <EntryWindow>
      <h1 tabIndex={-1} ref={heading}>
        {workspace.team.displayName || workspace.team.name}
      </h1>
      <p className="entry-address" dir="ltr">
        {workspace.serverUrl}
      </p>
      {workspace.directoryNotice && (
        <p role="status">{teamText[language][workspace.directoryNotice]}</p>
      )}
      <button
        className="entry-secondary"
        type="button"
        onClick={workspace.chooseAnotherTeam}
      >
        {sessionText[language].chooseTeam}
      </button>
    </EntryWindow>
  );
}
