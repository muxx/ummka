import { useId, useMemo, useState } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import { PrivateChannelIcon } from "./PrivateChannelIcon.tsx";
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
  language,
  choose,
  retry,
}: {
  state: WorkspaceRead<TeamSidebar>;
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
      <h2 id={heading}>{text.joined}</h2>
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
                      <span className="directory-kind" aria-hidden="true">
                        {channel.kind === "P" && !channel.deleteAt ? (
                          <PrivateChannelIcon />
                        ) : (
                          <svg
                            aria-hidden="true"
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.65"
                            strokeLinecap="round"
                          >
                            {channel.deleteAt ? (
                              <>
                                <rect
                                  x="3"
                                  y="4"
                                  width="18"
                                  height="4"
                                  rx="2"
                                />
                                <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4" />
                              </>
                            ) : (
                              <path d="M5 9h14M5 15h14M11 4 7 20M17 4l-4 16" />
                            )}
                          </svg>
                        )}
                      </span>
                      <span className="directory-channel-info">
                        <strong>{title}</strong>
                        <span id={`${heading}-${channel.id}`}>
                          {channel.purpose ||
                            (channel.kind === "P" ? text.private : text.public)}
                        </span>
                      </span>
                      {channel.deleteAt > 0 && (
                        <span className="directory-archived">
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
