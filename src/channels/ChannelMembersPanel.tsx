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
import {
  ChannelListStatus,
  channelListCopy,
  channelListError,
  channelListOffline,
} from "./ChannelListState.tsx";
import { PaneSizeToggle } from "./PaneWidthControls.tsx";
import { initials } from "./profile-initials.ts";
import { useNextPageButton } from "./use-next-page-button.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";

const copy = {
  en: {
    title: "Members",
    back: "Back to channel info",
    backToChannel: "Back to conversation",
    close: "Close members",
    search: "Find a member",
    guest: "Guest",
    loading: "Loading members…",
    empty: "No members",
    noMatches: (term: string) => `No members match “${term}”`,
    hint: "Check the spelling or clear the field",
    denied: "No access to channel members",
    more: "Show more members",
  },
  ru: {
    title: "Участники",
    back: "Вернуться к сведениям о канале",
    backToChannel: "Вернуться в беседу",
    close: "Закрыть участников",
    search: "Найти участника",
    guest: "Гость",
    loading: "Загружаем участников…",
    empty: "Участников нет",
    noMatches: (term: string) => `Никого по запросу «${term}»`,
    hint: "Проверьте написание или очистите поле",
    denied: "Нет доступа к участникам",
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
  back?: () => void;
  direct?: boolean;
  close: () => void;
  sessionIssue: (reason: "session" | "unauthorized") => void;
};
type Page = Awaited<ReturnType<Props["account"]["readChannelMemberDirectory"]>>;
type Results = Page & { status: "loading" | "ready" | "failed" | "denied" };
const initial: Results = { status: "loading", members: [], nextPage: null };

export function ChannelMembersPanel({
  account,
  channelId,
  language,
  nameFormat,
  sessionIssue,
  online,
  back,
  close,
  name,
  direct,
}: Props) {
  const [query, setQuery] = useState("");
  const term = query.trim();
  const [request, setRequest] = useState({ page: 0, attempt: 0 });
  const [results, setResults] = useState(initial);
  const [canFilter, setCanFilter] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [wasOnline, setWasOnline] = useState(online);
  if (online !== wasOnline) {
    setWasOnline(online);
    setResults(initial);
    setRequest({ page: 0, attempt: 0 });
    setRetrying(false);
    setCanFilter(false);
  }
  const report = useEffectEvent(sessionIssue);
  const t = copy[language];
  const listText = channelListCopy[language];
  useEffect(() => {
    if (!online) return;
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
        setRetrying(false);
        if (term || response.members.length) setCanFilter(true);
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
        setRetrying(false);
        const failure = workspaceFailure(error, "network");
        if (failure === "session" || failure === "unauthorized")
          report(failure);
        if (
          failure === "forbidden" ||
          failure === "session" ||
          failure === "unauthorized"
        ) {
          setCanFilter(false);
          setResults({ ...initial, status: "denied" });
        } else setResults((old) => ({ ...old, status: "failed" }));
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
  }, [account, channelId, term, request, online]);

  const title = useId();
  const stateId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const noticeHeading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<number | null>(null);
  function read(page: number, button: HTMLButtonElement, retryRead = false) {
    if (button === document.activeElement)
      returnFocus.current = results.members.length;
    setRetrying(retryRead);
    setResults((old) => ({ ...old, status: "loading" }));
    setRequest((old) => ({ page, attempt: old.attempt + 1 }));
  }
  const next = results.status === "ready" ? results.nextPage : null;
  const boundary = useNextPageButton(next, read);
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    if (results.status === "loading" && online) return;
    const index = returnFocus.current;
    returnFocus.current = null;
    const active = document.activeElement;
    if (results.status === "denied") {
      if (
        active === document.body ||
        active === heading.current ||
        active === search.current
      )
        noticeHeading.current?.focus({ preventScroll: true });
      return;
    }
    if (
      index === null ||
      (active !== document.body &&
        active !== retry.current &&
        active !== boundary.current)
    )
      return;
    const target =
      results.status === "failed"
        ? retry.current
        : request.page === 0 && search.current
          ? search.current
          : (list.current?.children.item(index) ??
            noticeHeading.current ??
            boundary.current ??
            list.current?.lastElementChild);
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }, [results, request.page, online, boundary]);

  const loading = online && results.status === "loading";
  const edge = request.page > 0 && (loading || results.status === "failed");
  const waitingOnBoundary =
    edge && loading && !retrying && returnFocus.current !== null;
  const empty =
    results.status === "ready" && !results.members.length && next === null;
  const fieldLocked = !online || !canFilter;
  const notice = !online
    ? channelListOffline(language)
    : results.status === "denied"
      ? { variant: "error" as const, title: t.denied }
      : results.status === "failed" || retrying
        ? channelListError(language, edge)
        : loading
          ? {
              variant: "pending" as const,
              message: edge ? listText.loadingMore : t.loading,
            }
          : empty
            ? {
                variant: "empty" as const,
                title: term ? t.noMatches(term) : t.empty,
                message: term ? t.hint : undefined,
              }
            : null;

  return (
    <aside
      className="channels-thread channel-information channel-context-pane channel-members-panel"
      aria-labelledby={title}
    >
      <header className="channels-pane-head">
        {back && (
          <button
            className="channels-icon-action"
            type="button"
            aria-label={direct ? t.backToChannel : t.back}
            onClick={back}
          >
            ←
          </button>
        )}
        <div className="channels-pane-titles">
          <h2 ref={heading} tabIndex={-1} id={title}>
            <MembersIcon />
            {t.title}
          </h2>
          <p>{name}</p>
        </div>
        <PaneSizeToggle />
        <button
          className={
            back
              ? "channels-icon-action channel-members-close"
              : "channels-icon-action"
          }
          type="button"
          aria-label={t.close}
          onClick={close}
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path className="channel-info-close" d="m6 6 12 12m0-12L6 18" />
            <path className="channel-info-back" d="m11 5-7 7 7 7M4 12h16" />
          </svg>
        </button>
      </header>
      <div className="channel-member-body" aria-busy={loading || undefined}>
        {(!empty || term) && (
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
              className="panel-text--body"
              ref={search}
              value={query}
              readOnly={fieldLocked}
              aria-disabled={fieldLocked || undefined}
              aria-describedby={fieldLocked && notice ? stateId : undefined}
              aria-label={t.search}
              placeholder={t.search}
              onChange={(e) => {
                if (fieldLocked) return;
                const value = e.currentTarget.value;
                setQuery(value);
                if (value.trim() !== term) {
                  setResults(initial);
                  setRequest({ page: 0, attempt: 0 });
                  setRetrying(false);
                }
              }}
            />
          </label>
        )}
        <div className="channel-member-results">
          {online && results.members.length > 0 && (
            <ul ref={list} className="channel-member-list">
              {results.members.map((row) => {
                const memberName = teammateName(row.profile, nameFormat);
                return (
                  <li key={row.profile.id} tabIndex={-1}>
                    <span aria-hidden="true" className="timeline-avatar">
                      {initials(memberName)}
                    </span>
                    <div>
                      <strong>{memberName}</strong>
                      {(row.schemeGuest || row.profile.isGuest) && (
                        <small className="channel-member-guest">
                          {t.guest}
                        </small>
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
          <ChannelListStatus
            language={language}
            notice={waitingOnBoundary ? null : notice}
            edge={edge}
            stateId={stateId}
            heading={noticeHeading}
            retry={
              online && (results.status === "failed" || retrying)
                ? {
                    running: retrying,
                    button: retry,
                    read: () => {
                      if (retry.current)
                        read(request.page, retry.current, true);
                    },
                  }
                : undefined
            }
          />
          {(next !== null || waitingOnBoundary) && (
            <button
              ref={boundary}
              className="channel-list-more"
              type="button"
              aria-busy={waitingOnBoundary || undefined}
              aria-disabled={waitingOnBoundary || undefined}
              onClick={(e) => {
                if (next !== null) read(next, e.currentTarget);
              }}
            >
              {waitingOnBoundary ? listText.loadingMore : t.more}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
