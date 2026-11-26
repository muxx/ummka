import { useEffect, useId, useRef, useState } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import { AvailableChannels } from "./AvailableChannels.tsx";
import { availableDirectoryCopy } from "./available-directory-copy.ts";
import {
  channelDirectoryCopy,
  JoinedChannelDirectory,
} from "./JoinedChannelDirectory.tsx";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import type { WorkspaceRead } from "./workspace-data.ts";

export type DirectoryProps = {
  account: Pick<
    WorkspaceConnection,
    | "readChannelDirectoryPage"
    | "searchChannelDirectory"
    | "changeOwnMembership"
  >;
  teamId: string;
  state: WorkspaceRead<TeamSidebar>;
  language: EntryLanguage;
  online: boolean;
  choose: (id: string) => void;
  refresh: () => void;
  sessionIssue: (issue: "session" | "unauthorized") => void;
};
export function TeamChannelDirectory({
  canBrowse,
  ...props
}: DirectoryProps & { canBrowse: boolean }) {
  const id = useId(),
    joinedButton = useRef<HTMLButtonElement>(null),
    availableButton = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<"joined" | "available">("joined"),
    [started, setStarted] = useState(false);
  const eligible =
    canBrowse &&
    !["forbidden", "unauthorized", "session"].includes(props.state.status);
  const available = eligible && tab === "available";
  const text = channelDirectoryCopy[props.language];
  useEffect(() => {
    if (!eligible) {
      setStarted(false);
      setTab("joined");
    }
  }, [eligible]);
  function select(next: "joined" | "available") {
    if (next === "available") setStarted(true);
    setTab(next);
  }
  const joined = (
    <JoinedChannelDirectory
      language={props.language}
      state={props.state}
      choose={props.choose}
      retry={props.refresh}
      headingVisible={!eligible}
    />
  );
  if (!eligible) return joined;
  return (
    <div className="team-channel-directory">
      <div
        role="tablist"
        className="directory-tabs"
        aria-label={text.title}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? "joined"
              : event.key === "End"
                ? "available"
                : available
                  ? "joined"
                  : "available";
          select(next);
          (next === "joined" ? joinedButton : availableButton).current?.focus();
        }}
      >
        {(["joined", "available"] as const).map((name) => (
          <button
            type="button"
            role="tab"
            key={name}
            id={id + name}
            ref={name === "joined" ? joinedButton : availableButton}
            aria-selected={name === tab}
            aria-controls={`${id}${name}-panel`}
            tabIndex={name === tab ? 0 : -1}
            onClick={() => select(name)}
          >
            {name === "joined"
              ? text.joined
              : availableDirectoryCopy[props.language].available}
          </button>
        ))}
      </div>
      <div
        className="directory-scroll"
        hidden={available}
        role="tabpanel"
        aria-labelledby={`${id}joined`}
        id={`${id}joined-panel`}
      >
        {!available && joined}
      </div>
      <div
        hidden={!available}
        role="tabpanel"
        aria-labelledby={`${id}available`}
        id={`${id}available-panel`}
        className="directory-scroll"
      >
        {started && <AvailableChannels {...props} active={available} />}
      </div>
    </div>
  );
}
