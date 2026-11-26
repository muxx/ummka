import { useId, useMemo, useState } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import { DirectoryChannelIcon } from "./DirectoryChannelIcon.tsx";
import { workspaceCopy } from "./workspace-copy.ts";
import type { WorkspaceRead } from "./workspace-data.ts";
import "./channel-directory.css";

export const channelDirectoryCopy = {
  en: {
    title: "Directory",
    joined: "My channels",
    find: "Find a channel",
    public: "Public channel",
    private: "Private channel",
    archived: "Archived",
    noMatches: "No matching channels.",
  },
  ru: {
    title: "Каталог",
    joined: "Мои каналы",
    find: "Найти канал",
    public: "Открытый канал",
    private: "Закрытый канал",
    archived: "В архиве",
    noMatches: "Совпадений нет.",
  },
} as const;

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
}: {
  state: WorkspaceRead<TeamSidebar>;
  headingVisible?: boolean;
  language: EntryLanguage;
  choose: (channelId: string) => void;
  retry: () => void;
}) {
  const text = channelDirectoryCopy[language],
    workspace = workspaceCopy[language];
  const heading = useId();
  const [input, setInput] = useState("");
  const channels = state.value?.data.channels;
  const rows = useMemo(() => {
    return (channels ?? [])
      .filter((c) => c.kind === "O" || c.kind === "P")
      .map((c) => ({
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
  return (
    <section className="channel-directory" aria-labelledby={heading}>
      <h2 id={heading} hidden={!headingVisible}>
        {text.joined}
      </h2>
      {!denied && state.value && (
        <input
          className="directory-filter"
          type="search"
          aria-label={text.find}
          placeholder={text.find}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      )}
      {denied ? (
        <p role="alert">{workspace.forbidden}</p>
      ) : (
        <>
          {unavailable && (
            <p role="alert">
              {workspace[status]}{" "}
              <button type="button" onClick={retry}>
                {workspace.retry}
              </button>
            </p>
          )}
          {status === "offline" && (
            <p role="status">
              {state.value ? workspace.offline : workspace.noCache}
            </p>
          )}
          {!state.value &&
            (status === "loading" || status === "refreshing") && (
              <p role="status">{workspace.loading}</p>
            )}
          {state.value &&
            (matches.length ? (
              <ul aria-labelledby={heading}>
                {matches.map(({ channel, title }) => (
                  <li key={channel.id}>
                    <button
                      type="button"
                      className="directory-channel"
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
            ) : (
              <p role="status">
                {rows.length ? text.noMatches : workspace.empty}
              </p>
            ))}
        </>
      )}
    </section>
  );
}
