import { type RefObject, useId, useMemo, useRef, useState } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import { DirectoryChannelIcon } from "./DirectoryChannelIcon.tsx";
import { DirectoryPosition } from "./DirectoryPosition.tsx";
import { DirectorySearch, directoryCopy } from "./DirectorySurface.tsx";
import { PanelRetry, PanelState } from "./PanelState.tsx";
import { workspaceCopy } from "./workspace-copy.ts";
import type { WorkspaceRead } from "./workspace-data.ts";

const compareNames = new Intl.Collator().compare;

function folded(value: string) {
  return value.toLowerCase().replaceAll("ё", "е");
}

export function JoinedChannelDirectory({
  state,
  headingVisible = true,
  language,
  choose,
  retry,
  scroll,
  visible,
}: {
  state: WorkspaceRead<TeamSidebar>;
  headingVisible?: boolean;
  language: EntryLanguage;
  choose: (channelId: string) => void;
  retry: () => void;
  scroll: RefObject<HTMLDivElement | null>;
  visible: boolean;
}) {
  const text = directoryCopy[language],
    workspace = workspaceCopy[language];
  const heading = useId();
  const emptyHeading = useRef<HTMLHeadingElement>(null);
  const [input, setInput] = useState("");
  const channels = state.value?.data.channels;
  const rows = useMemo(() => {
    return (channels ?? [])
      .filter((c) => c.kind === "O" || c.kind === "P")
      .map((c) => ({
        id: c.id,
        channel: c,
        title: c.displayName || c.name,
        key: folded(c.displayName || c.name),
        handle: folded(c.name),
      }))
      .sort((a, b) => compareNames(a.title, b.title));
  }, [channels]);
  const query = folded(input.trim().replace(/^#/, ""));
  const matches = useMemo(
    () =>
      query
        ? rows.filter((r) => r.key.includes(query) || r.handle.includes(query))
        : rows,
    [rows, query],
  );
  const { status } = state;
  const denied =
    status === "forbidden" || status === "unauthorized" || status === "session";
  const unavailable = status === "network" || status === "storage";
  const content = visible && (
    <section
      className="channel-directory directory-column"
      aria-labelledby={heading}
    >
      <h2 id={heading} tabIndex={-1} hidden={!headingVisible}>
        {text.joined}
      </h2>
      {!denied && state.value && (
        <DirectorySearch
          language={language}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      )}
      {denied ? (
        <PanelState
          variant="error"
          role="alert"
          message={workspace.forbidden}
        />
      ) : (
        <>
          {unavailable && (
            <PanelState
              variant={state.value ? "stale" : "error"}
              role="alert"
              message={workspace[status]}
              action={
                <PanelRetry onClick={retry}>{workspace.retry}</PanelRetry>
              }
            />
          )}
          {status === "offline" && (
            <PanelState
              variant={state.value ? "stale" : "offline"}
              role="status"
              title={state.value ? undefined : workspace.offlineEmpty}
              message={state.value ? workspace.offline : workspace.noCache}
            />
          )}
          {!state.value &&
            (status === "loading" || status === "refreshing") && (
              <PanelState
                variant="pending"
                role="status"
                message={workspace.loading}
              />
            )}
          {state.value &&
            (matches.length ? (
              <ul aria-labelledby={heading} data-directory-rows>
                {matches.map(({ channel, title }) => (
                  <li key={channel.id}>
                    <button
                      type="button"
                      className="directory-channel"
                      data-directory-id={channel.id}
                      aria-label={[
                        title,
                        channel.kind === "P" ? text.private : text.public,
                        channel.deleteAt ? text.archived : "",
                      ]
                        .filter(Boolean)
                        .join(", ")}
                      aria-describedby={
                        channel.purpose ? `${heading}-${channel.id}` : undefined
                      }
                      onClick={() => choose(channel.id)}
                    >
                      <DirectoryChannelIcon
                        kind={
                          channel.deleteAt
                            ? "archived"
                            : channel.kind === "P"
                              ? "private"
                              : "public"
                        }
                      />
                      <span className="directory-channel-info">
                        <strong>{title}</strong>
                        <span id={`${heading}-${channel.id}`}>
                          {channel.purpose ||
                            (channel.kind === "P" ? text.private : text.public)}
                        </span>
                      </span>
                      {channel.deleteAt > 0 && (
                        <span className="directory-channel-meta">
                          {text.archived}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : query ? (
              <PanelState
                variant="empty"
                role="status"
                title={text.noMatches}
                titleRef={emptyHeading}
                message={
                  headingVisible ? text.changeQuery : text.changeQueryOrTab
                }
              />
            ) : (
              <PanelState
                variant="empty"
                role="status"
                title={workspace.empty}
                titleRef={emptyHeading}
              />
            ))}
        </>
      )}
    </section>
  );
  return (
    <DirectoryPosition
      scroll={scroll}
      visible={visible}
      query={query}
      rows={matches}
      layout={[language, headingVisible, status, Boolean(state.value)]}
    >
      {content}
    </DirectoryPosition>
  );
}
