import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usesMacOSOverlay } from "../build-platform.ts";
import type { EntryLanguage } from "../entry/language.ts";
import {
  directPartnerId,
  indexChannelProfiles,
} from "../mattermost/channel-profiles.ts";
import {
  conversationTitleMatch,
  knownConversationTerm,
  prepareKnownConversationSearch,
} from "../mattermost/known-conversation-search.ts";
import type { SavedProfiles } from "../mattermost/native-rest.ts";
import { sidebarCategoryName } from "../mattermost/sidebar-rows.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import type { WorkspacePreferences } from "../mattermost/workspace-preferences.ts";
import { directInitial } from "./SidebarConversationRow.tsx";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceCopy } from "./workspace-copy.ts";
import { workspaceFailure } from "./workspace-data.ts";
import "./quick-switch.css";

const copy = {
  en: {
    open: "Find a channel",
    field: "Find a channel or direct message",
    placeholder: "Channel or direct message",
    recent: "Recent",
    matches: "Channels and direct messages",
    empty: "No conversations found",
    archived: "Archived",
    unread: "Unread messages",
    keyboard: "↑ ↓ choose · Enter open · Esc close",
    count: (total: number) => `Conversations found: ${total}`,
    loading: "Loading saved conversations…",
    hint: "Try another name. Use the search in the top bar to find messages.",
    close: "Close",
  },
  ru: {
    open: "Найти канал",
    field: "Найти канал или личную переписку",
    placeholder: "Канал или личная переписка",
    recent: "Недавние",
    matches: "Каналы и личные сообщения",
    empty: "Беседа не найдена",
    archived: "В архиве",
    unread: "Есть непрочитанные",
    keyboard: "↑ ↓ выбрать · Enter открыть · Esc закрыть",
    count: (total: number) => `Нашлось бесед: ${total}`,
    loading: "Загружаем сохранённые беседы…",
    hint: "Проверьте название. Слова из переписки ищет поле «Поиск» в шапке.",
    close: "Закрыть",
  },
};

const icons = {
  close: "M5 5l14 14 M19 5 5 19",
  search: "M20 20l-5-5 M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13Z",
  O: "M5 8h15 M4 16h15 M11 3 7 21 M18 3l-4 18",
  P: "M8 10V7a4 4 0 1 1 8 0v3 M6 10h12v10H6z",
  G: "M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2 M9 3a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7Z M16 4a3.5 3.5 0 0 1 0 6 M17 14a5 5 0 0 1 4 5",
  archive: "M3 4h18v4H3z M5 8v12h14V8 M10 12h4",
};
function SwitchIcon({ kind }: { kind: keyof typeof icons }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[kind]} />
    </svg>
  );
}

type Source = {
  connection: Pick<WorkspaceConnection, "readSavedProfiles">;
  snapshot: TeamSidebar | null;
  preferences: WorkspacePreferences | null;
  visible: SavedProfiles;
  userId: string;
  language: EntryLanguage;
  recent: ReadonlySet<string>;
  unavailable: string;
  sessionIssue: (issue: "session" | "unauthorized") => void;
};

function QuickSwitchDialog({
  source,
  choose,
  dismiss,
}: {
  source: Source;
  choose: (id: string) => void;
  dismiss: () => void;
}) {
  const {
    snapshot,
    preferences,
    visible,
    userId,
    language,
    connection,
    recent,
    sessionIssue,
    unavailable,
  } = source;
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const label = useId(),
    list = useId();
  const text = copy[language],
    workspace = workspaceCopy[language];
  const [term, setTerm] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const channels = snapshot?.data.channels;
  const [local, setLocal] = useState<{
    channels: typeof channels;
    account: Source["connection"];
    profiles: SavedProfiles | null;
  } | null>(null);
  useLayoutEffect(() => {
    const node = dialog.current;
    node?.showModal();
    field.current?.focus();
    return () => node?.close();
  }, []);
  const profileQuery = useMemo(() => {
    if (!channels) return null;
    const ids = new Set<string>();
    const usernames = new Set<string>();
    for (const row of channels) {
      if (row.kind === "D") {
        const peer = directPartnerId(row.name, userId);
        if (peer) ids.add(peer);
      } else if (row.kind === "G" && row.displayName !== row.name) {
        for (const name of row.displayName.split(", "))
          if (name.trim()) usernames.add(name);
      }
    }
    return ids.size || usernames.size
      ? { ids: [...ids], usernames: [...usernames] }
      : null;
  }, [channels, userId]);
  useEffect(() => {
    if (!profileQuery) return;
    let active = true;
    void connection.readSavedProfiles(profileQuery).then(
      (profiles) => {
        if (active) setLocal({ account: connection, channels, profiles });
      },
      (error) => {
        if (!active) return;
        const issue = workspaceFailure(error, "storage");
        if (issue === "session" || issue === "unauthorized")
          sessionIssue(issue);
        else setLocal({ account: connection, channels, profiles: null });
      },
    );
    return () => {
      active = false;
    };
  }, [profileQuery, channels, connection, sessionIssue]);
  const resolved =
    local?.channels === channels && local?.account === connection
      ? local
      : null;
  const search = useMemo(() => {
    if (!snapshot || !preferences) return null;
    const saved = resolved?.profiles ?? visible;
    const profiles = indexChannelProfiles(
      Object.values(saved.profiles),
      saved.usernames,
    );
    return prepareKnownConversationSearch(
      snapshot,
      {
        userId,
        profiles,
        preferences,
        locale: language,
      },
      [...recent].reverse(),
    );
  }, [snapshot, preferences, visible, userId, language, resolved, recent]);
  const categories = snapshot?.data.categories;
  const categoryTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const category of categories ?? []) {
      const title = sidebarCategoryName(category, language);
      for (const id of category.channelIds)
        if (!titles.has(id)) titles.set(id, title);
    }
    return titles;
  }, [categories, language]);
  const query = knownConversationTerm(term);
  const rows = useMemo(() => search?.(term) ?? [], [search, term]);
  const current = rows.find((row) => row.id === cursor) ?? rows[0];
  function move(offset: number) {
    if (!current) return;
    const index = (rows.indexOf(current) + offset + rows.length) % rows.length;
    setCursor(rows[index].id);
    document
      .getElementById(list + rows[index].id)
      ?.scrollIntoView?.({ block: "nearest" });
  }
  return (
    <dialog
      className="channels-search-dialog quick-switch-dialog modal-layout"
      ref={dialog}
      aria-labelledby={label}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <header>
        <h2 id={label}>{text.open}</h2>
        <button
          className="quick-switch-close"
          type="button"
          onClick={dismiss}
          aria-label={text.close}
        >
          <SwitchIcon kind="close" />
        </button>
      </header>
      <div className="quick-switch-field">
        <SwitchIcon kind="search" />
        <input
          type="search"
          role="combobox"
          ref={field}
          aria-label={text.field}
          autoComplete="off"
          enterKeyHint="go"
          aria-expanded={rows.length > 0}
          aria-autocomplete="list"
          aria-controls={list}
          aria-activedescendant={current ? list + current.id : undefined}
          placeholder={text.placeholder}
          value={term}
          onChange={(event) => {
            setTerm(event.currentTarget.value);
            setCursor(null);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              dismiss();
            } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              move(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Enter" && current) {
              event.preventDefault();
              choose(current.id);
            }
          }}
        />
      </div>
      <div className="quick-switch-results modal-scroll">
        {rows.length > 0 && <h3>{query ? text.matches : text.recent}</h3>}
        <div
          role="listbox"
          id={list}
          aria-label={text.matches}
          className="quick-switch-list"
        >
          {rows.map((row) => {
            const range = conversationTitleMatch(row.title, query);
            const detail = row.archived
              ? text.archived
              : row.unread
                ? text.unread
                : "";
            const category = categoryTitles.get(row.id);

            return (
              <button
                key={row.id}
                id={list + row.id}
                role="option"
                type="button"
                tabIndex={-1}
                aria-label={row.title}
                aria-description={
                  [detail, category].filter(Boolean).join(" · ") || undefined
                }
                aria-selected={row.id === current?.id}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setCursor(row.id)}
                onClick={() => choose(row.id)}
              >
                <span
                  className={
                    row.kind === "D"
                      ? "quick-switch-avatar"
                      : "quick-switch-icon"
                  }
                  aria-hidden="true"
                >
                  {row.kind === "D" ? (
                    directInitial(row.displayName, language)
                  ) : (
                    <SwitchIcon
                      kind={
                        row.archived
                          ? "archive"
                          : row.kind === "G" || row.kind === "P"
                            ? row.kind
                            : "O"
                      }
                    />
                  )}
                </span>
                <span className="quick-switch-copy">
                  <strong>
                    {range ? (
                      <>
                        {row.title.slice(0, range[0])}
                        <mark>{row.title.slice(range[0], range[1])}</mark>
                        {row.title.slice(range[1])}
                      </>
                    ) : (
                      row.title
                    )}
                  </strong>
                  {detail && <small>{detail}</small>}
                </span>
                {category && (
                  <span className="quick-switch-meta">{category}</span>
                )}
              </button>
            );
          })}
        </div>
        {!rows.length && resolved?.profiles !== null && (
          <div className="quick-switch-empty" role="status">
            {!search ? (
              unavailable
            ) : profileQuery && !resolved ? (
              text.loading
            ) : (
              <>
                <SwitchIcon kind="search" />
                <h3>{text.empty}</h3>
                <p>{text.hint}</p>
              </>
            )}
          </div>
        )}
        {resolved?.profiles === null && <p role="alert">{workspace.storage}</p>}
        {query && rows.length > 0 && (
          <span className="quick-switch-status" role="status">
            {text.count(rows.length)}
          </span>
        )}
      </div>
      <footer className="quick-switch-keys">{text.keyboard}</footer>
    </dialog>
  );
}

export function useWorkspaceQuickSwitch(
  source: Source,
  choose: (id: string, origin: HTMLElement | null) => void,
) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const text = copy[source.language];
  const show = useCallback((origin: HTMLElement | null) => {
    opener.current = origin;
    restore.current = false;
    setOpen(true);
  }, []);
  const dismiss = useCallback(() => {
    restore.current = true;
    setOpen(false);
  }, []);
  useLayoutEffect(() => {
    if (!open && restore.current) {
      restore.current = false;
      (opener.current?.isConnected ? opener.current : trigger.current)?.focus({
        preventScroll: true,
      });
    }
  }, [open]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.shiftKey ||
        event.ctrlKey === event.metaKey ||
        !(usesMacOSOverlay ? event.metaKey : event.ctrlKey) ||
        event.code !== "KeyK"
      )
        return;
      if (!open && document.querySelector("dialog[open]")) return;
      event.preventDefault();
      if (event.repeat) return;
      if (open) dismiss();
      else
        show(
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
        );
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [open, show, dismiss]);
  return {
    trigger: (
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-label={text.open}
        aria-keyshortcuts={usesMacOSOverlay ? "Meta+K" : "Control+K"}
        className="workspace-quick-trigger"
        onClick={(event) => show(event.currentTarget)}
      >
        <SwitchIcon kind="search" />
        {text.open}
        <kbd>{usesMacOSOverlay ? "⌘K" : "Ctrl+K"}</kbd>
      </button>
    ),
    dialog: open && (
      <QuickSwitchDialog
        source={source}
        dismiss={dismiss}
        choose={(id) => {
          setOpen(false);
          choose(id, opener.current);
        }}
      />
    ),
  };
}
