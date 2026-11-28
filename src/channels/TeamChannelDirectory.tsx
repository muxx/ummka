import {
  type FocusEvent,
  type Ref,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import { AvailableChannels } from "./AvailableChannels.tsx";
import { availableDirectoryCopy } from "./available-directory-copy.ts";
import { directoryFocusFallback, directoryRow } from "./DirectoryPosition.tsx";
import { directoryCopy } from "./DirectorySurface.tsx";
import { JoinedChannelDirectory } from "./JoinedChannelDirectory.tsx";
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
type DirectoryControl =
  | { kind: "joined" | "available" | "filter" | "content" }
  | { kind: "row"; id: string };

export function TeamChannelDirectory({
  canBrowse,
  visible = true,
  ref,
  ...props
}: DirectoryProps & {
  canBrowse: boolean;
  visible?: boolean;
  ref?: Ref<() => boolean>;
}) {
  const id = useId(),
    joinedButton = useRef<HTMLButtonElement>(null),
    availableButton = useRef<HTMLButtonElement>(null),
    joinedScroll = useRef<HTMLDivElement>(null),
    availableScroll = useRef<HTMLDivElement>(null),
    lastFocus = useRef<DirectoryControl>(null);
  const [tab, setTab] = useState<"joined" | "available">("joined"),
    [started, setStarted] = useState(false);
  const visited = useRef(false);
  const eligible =
    canBrowse &&
    !["forbidden", "unauthorized", "session"].includes(props.state.status);
  const available = eligible && tab === "available";
  const text = directoryCopy[props.language];
  useLayoutEffect(() => {
    if (visible) visited.current = true;
  }, [visible]);
  useLayoutEffect(() => {
    if (eligible) return;
    setStarted(false);
    setTab("joined");
    if (
      visible &&
      lastFocus.current &&
      document.activeElement === document.body
    )
      joinedScroll.current
        ?.querySelector<HTMLElement>("h2")
        ?.focus({ preventScroll: true });
  }, [eligible, visible]);
  useImperativeHandle(
    ref,
    () => () => {
      const control = lastFocus.current;
      const pane = (available ? availableScroll : joinedScroll).current;
      if (!visible || !pane || !control) return false;
      let target: HTMLElement | null = null;
      switch (control.kind) {
        case "joined":
          target = joinedButton.current;
          break;
        case "available":
          target = availableButton.current;
          break;
        case "filter":
          target = pane.querySelector(".directory-filter:not(:disabled)");
          break;
        case "row":
          target = directoryRow(pane, control.id);
          break;
      }
      target ??= directoryFocusFallback(pane);
      if (!target) return false;
      const scrollTop = pane.scrollTop;
      target.focus({ preventScroll: true });
      if (document.activeElement !== target) return false;
      // WebKit can reveal a newly mounted, partially clipped control after
      // focus() has returned. Keep the reading position before the paint.
      if (pane.contains(target))
        requestAnimationFrame(() => {
          if (
            pane.contains(target) &&
            document.activeElement === target &&
            pane.scrollTop !== scrollTop
          )
            pane.scrollTop = scrollTop;
        });
      return true;
    },
    [visible, available],
  );
  if (!visible && !visited.current) return null;
  function captureFocus(event: FocusEvent<HTMLDivElement>) {
    const control: EventTarget = event.target;
    if (!(control instanceof HTMLElement) || control.closest("dialog")) return;
    if (control === joinedButton.current)
      lastFocus.current = { kind: "joined" };
    else if (control === availableButton.current)
      lastFocus.current = { kind: "available" };
    else if (control.matches(".directory-filter"))
      lastFocus.current = { kind: "filter" };
    else if (control.dataset.directoryId)
      lastFocus.current = { kind: "row", id: control.dataset.directoryId };
    else lastFocus.current = { kind: "content" };
  }
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
      scroll={joinedScroll}
      visible={visible && !available}
    />
  );
  if (!eligible)
    return (
      <div className="team-channel-directory" onFocusCapture={captureFocus}>
        <div className="directory-scroll" ref={joinedScroll}>
          {joined}
        </div>
      </div>
    );
  return (
    <div className="team-channel-directory" onFocusCapture={captureFocus}>
      <div className="directory-tab-strip">
        <div
          role="tablist"
          className="directory-tabs directory-column panel-tabs"
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
            (next === "joined"
              ? joinedButton
              : availableButton
            ).current?.focus();
          }}
        >
          {(["joined", "available"] as const).map((name) => (
            <button
              type="button"
              className="panel-tabs__tab"
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
      </div>
      <div
        className="directory-scroll"
        ref={joinedScroll}
        hidden={available}
        role="tabpanel"
        aria-labelledby={`${id}joined`}
        id={`${id}joined-panel`}
      >
        {!available && joined}
      </div>
      <div
        hidden={!available}
        ref={availableScroll}
        role="tabpanel"
        aria-labelledby={`${id}available`}
        id={`${id}available-panel`}
        className="directory-scroll"
      >
        {started && (
          <AvailableChannels
            {...props}
            selectedTab={available}
            visible={visible}
            scroll={availableScroll}
          />
        )}
      </div>
    </div>
  );
}
