import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import {
  type NameFormat,
  teammateName,
} from "../mattermost/channel-profiles.ts";
import { MembersIcon } from "./ChannelInformationPanel.tsx";
import { PaneSizeToggle } from "./PaneWidthControls.tsx";
import { initials } from "./profile-initials.ts";
import { useNextPageButton } from "./use-next-page-button.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";

const copy = {
  en: {
    title: "Members",
    back: "Back to channel info",
    close: "Close members",
    search: "Find a member",
    guest: "Guest",
    loading: "Loading members…",
    offline: "Connect to see channel members.",
    empty: "No members to show",
    noMatches: "No matching members",
    denied: "Channel members are unavailable.",
    failed: "Couldn’t load channel members.",
    retry: "Try again",
    more: "Show more members",
  },
  ru: {
    title: "Участники",
    back: "Вернуться к сведениям о канале",
    close: "Закрыть участников",
    search: "Найти участника",
    guest: "Гость",
    loading: "Загрузка участников…",
    offline: "Подключитесь к сети, чтобы увидеть участников.",
    empty: "Нет участников для показа",
    noMatches: "Участники не найдены",
    denied: "Состав канала недоступен.",
    failed: "Не удалось загрузить участников.",
    retry: "Повторить",
    more: "Показать ещё участников",
  },
};
type Props = {
  account: Pick<WorkspaceConnection, "readChannelMemberDirectory">;
  channelId: string;
  name: string;
  language: EntryLanguage;
  nameFormat: NameFormat;
  online: boolean;
  back: () => void;
  close: () => void;
  sessionIssue: (reason: "session" | "unauthorized") => void;
};
type Page = Awaited<ReturnType<Props["account"]["readChannelMemberDirectory"]>>;
type Results = Page & { status: "loading" | "ready" | "failed" | "denied" };
const initial: Results = { status: "loading", members: [], nextPage: null };

function MemberResults({
  account,
  channelId,
  term,
  language,
  nameFormat,
  sessionIssue,
}: Pick<
  Props,
  "account" | "channelId" | "language" | "nameFormat" | "sessionIssue"
> & { term: string }) {
  const [request, setRequest] = useState({ page: 0, attempt: 0 });
  const [results, setResults] = useState(initial);
  const report = useEffectEvent(sessionIssue);
  const t = copy[language];
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      try {
        const response = await account.readChannelMemberDirectory(
          channelId,
          term
            ? { kind: "search", term }
            : { kind: "page", page: request.page },
          signal,
        );
        if (signal.aborted) return;
        setResults((previous) => {
          const byId = new Map(
            previous.members.map((row) => [row.profile.id, row]),
          );
          for (const row of response.members) byId.set(row.profile.id, row);
          return {
            status: "ready",
            members: [...byId.values()],
            nextPage: response.nextPage,
          };
        });
      } catch (error) {
        if (signal.aborted) return;
        const failure = workspaceFailure(error, "network");
        if (failure === "session" || failure === "unauthorized")
          report(failure);
        if (
          failure === "forbidden" ||
          failure === "session" ||
          failure === "unauthorized"
        )
          setResults({ ...initial, status: "denied" });
        else setResults((old) => ({ ...old, status: "failed" }));
      }
    }
    const timer =
      term && request.attempt === 0
        ? window.setTimeout(() => void load(), 100)
        : undefined;
    if (timer === undefined) void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [account, channelId, term, request]);
  const list = useRef<HTMLUListElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLParagraphElement>(null);
  const returnFocus = useRef<number | null>(null);
  function read(page: number, button: HTMLButtonElement | null) {
    if (button && document.activeElement === button)
      returnFocus.current = results.members.length;
    setResults((old) => ({ ...old, status: "loading" }));
    setRequest((old) => ({ page, attempt: old.attempt + 1 }));
  }
  const next = results.status === "ready" ? results.nextPage : null;
  const boundary = useNextPageButton(next, read);
  useLayoutEffect(() => {
    const index = returnFocus.current;
    if (index === null || results.status === "loading") return;
    returnFocus.current = null;
    if (document.activeElement !== document.body) return;
    const newRow = list.current?.children.item(index);
    const target =
      newRow ??
      retry.current ??
      boundary.current ??
      notice.current ??
      list.current?.lastElementChild;
    if (target instanceof HTMLElement) target.focus();
  }, [results, boundary]);
  return (
    <>
      {results.members.length > 0 && (
        <ul ref={list} className="channel-member-list">
          {results.members.map((row) => {
            const name = teammateName(row.profile, nameFormat);
            return (
              <li key={row.profile.id} tabIndex={-1}>
                <span aria-hidden="true" className="timeline-avatar">
                  {initials(name)}
                </span>
                <div>
                  <strong>{name}</strong>
                  {(row.schemeGuest || row.profile.isGuest) && (
                    <small className="channel-member-guest">{t.guest}</small>
                  )}
                  <span className="channel-member-handle">
                    @{row.profile.username}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {results.status === "loading" && <p role="status">{t.loading}</p>}
      {results.status === "denied" && (
        <p role="alert" tabIndex={-1} ref={notice}>
          {t.denied}
        </p>
      )}
      {results.status === "failed" && (
        <>
          <p role="alert">{t.failed}</p>
          <button
            ref={retry}
            type="button"
            onClick={(e) => read(request.page, e.currentTarget)}
          >
            {t.retry}
          </button>
        </>
      )}
      {results.status === "ready" &&
        !results.members.length &&
        results.nextPage === null && (
          <p role="status" tabIndex={-1} ref={notice}>
            {term ? t.noMatches : t.empty}
          </p>
        )}
      {next !== null && (
        <button
          ref={boundary}
          type="button"
          onClick={(e) => read(next, e.currentTarget)}
        >
          {t.more}
        </button>
      )}
    </>
  );
}
export function ChannelMembersPanel(props: Props) {
  const { language, online, back, close, name } = props,
    t = copy[language];
  const [query, setQuery] = useState("");
  const title = useId(),
    heading = useRef<HTMLHeadingElement>(null),
    term = query.trim();
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <aside
      className="channels-thread channel-information channel-context-pane channel-members-panel"
      aria-labelledby={title}
    >
      <header className="channels-pane-head">
        <button
          className="channels-icon-action"
          type="button"
          aria-label={t.back}
          onClick={back}
        >
          ←
        </button>
        <div className="channels-pane-titles">
          <h2 ref={heading} tabIndex={-1} id={title}>
            <MembersIcon />
            {t.title}
          </h2>
          <p>{name}</p>
        </div>
        <PaneSizeToggle />
        <button
          className="channels-icon-action channel-members-close"
          type="button"
          aria-label={t.close}
          onClick={close}
        >
          ×
        </button>
      </header>
      <div className="channel-member-body">
        <label className="channel-member-search">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="6.5" />
            <path d="m15 15 6 6" />
          </svg>
          <input
            type="search"
            value={query}
            aria-label={t.search}
            placeholder={t.search}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="channel-member-results" key={term}>
          {online ? (
            <MemberResults {...props} term={term} />
          ) : (
            <p role="status">{t.offline}</p>
          )}
        </div>
      </div>
    </aside>
  );
}
