import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { IntegrationCard } from "../mattermost/integration-cards.ts";
import { CollectionHeader } from "./CollectionHeader.tsx";
import {
  CollectionReadNotice,
  useCollectionRefreshVisibility,
} from "./CollectionReadNotice.tsx";
import { CollectionScroll, restoreCollectionRow } from "./CollectionScroll.tsx";
import { collectionCopy } from "./collection-copy.ts";
import type { openMentionList } from "./mention-list.ts";
import { PanelState } from "./PanelState.tsx";
import { publishedPostSummary } from "./published-post-summary.ts";
import "./mentions.css";

type Model = ReturnType<typeof openMentionList>;
type Snapshot = ReturnType<Model["getSnapshot"]>;
export const mentionCopy = {
  en: {
    title: "Mentions",
    back: "Back to mentions",
    empty: "No mentions yet",
    detail: "Mentions of you and the whole channel will appear here.",
    more: "Load earlier mentions",
    close: "Close panel",
  },
  ru: {
    title: "Упоминания",
    back: "К упоминаниям",
    empty: "Упоминаний пока нет",
    detail: "Здесь появятся обращения к вам и ко всему каналу.",
    more: "Загрузить более ранние упоминания",
    close: "Закрыть панель",
  },
};

export function MentionMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-5.5 8.28" />
    </svg>
  );
}

const MentionExcerpt = memo(function MentionExcerpt({
  message,
  cards,
}: {
  message?: string;
  cards?: readonly IntegrationCard[];
}) {
  return <small>{publishedPostSummary({ message, cards })}</small>;
});

export function MentionsPane({
  compact,
  state,
  model,
  language,
  team,
  online,
  standalone,
  authorName,
  channelName,
  openRow,
  restore,
  close,
}: {
  compact: boolean;
  state: Snapshot;
  model: Model;
  language: EntryLanguage;
  team: string;
  online: boolean;
  standalone: boolean;
  authorName: (id: string) => string | undefined;
  channelName: (id: string) => string | undefined;
  openRow: (id: string, trigger: HTMLButtonElement, scroll: number) => void;
  restore: { id: string; scroll: number } | null;
  close: () => void;
}) {
  const showRefresh = useCollectionRefreshVisibility(
    state.status === "refreshing",
  );
  const text = mentionCopy[language],
    common = collectionCopy[language];
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLElement>(null);
  const edge = useRef<HTMLButtonElement>(null);
  const focusedPage = useRef<number | null>(null);
  const readNext = useCallback(() => {
    if (edge.current && document.activeElement === edge.current)
      focusedPage.current = state.items.length;
    void model.load();
  }, [model, state.items.length]);
  useLayoutEffect(() => {
    const index = focusedPage.current;
    if (index === null || state.edge === "loading") return;
    focusedPage.current = null;
    if (
      document.activeElement !== document.body &&
      document.activeElement !== edge.current
    )
      return;
    const fresh = state.items[index];
    const row =
      fresh &&
      list.current?.querySelector<HTMLButtonElement>(
        `[data-collection-post="${CSS.escape(fresh.id)}"]`,
      );
    (row ?? edge.current ?? heading.current)?.focus({ preventScroll: true });
  }, [state]);
  const initial = useRef(restore);
  useLayoutEffect(() => {
    if (!restoreCollectionRow(list.current, initial.current))
      heading.current?.focus();
  }, []);
  useEffect(() => {
    if (
      !online ||
      state.status !== "ready" ||
      state.edge !== "idle" ||
      state.nextPage === null ||
      !edge.current
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio > 0,
          )
        )
          readNext();
      },
      { root: list.current },
    );
    observer.observe(edge.current);
    return () => observer.disconnect();
  }, [online, readNext, state.status, state.nextPage, state.edge]);
  const date = useMemo(
    () => new Intl.DateTimeFormat(language, { day: "numeric", month: "long" }),
    [language],
  );
  const edgeFailed = state.edge === "network" || state.edge === "storage";
  return (
    <aside
      className="mentions-pane"
      data-standalone={standalone || undefined}
      aria-labelledby={id}
    >
      <CollectionHeader
        compact={compact}
        icon={<MentionMark />}
        caption={team}
        closeLabel={text.close}
        close={close}
      >
        <h2 ref={heading} tabIndex={-1} id={id}>
          {text.title}
        </h2>
      </CollectionHeader>
      <CollectionScroll pane={list} label={collectionCopy[language].content}>
        <CollectionReadNotice
          kind="mentions"
          status={state.status}
          showRefresh={showRefresh}
          hasResponse={state.hasResponse}
          online={online}
          language={language}
          list={list}
          heading={heading}
          refresh={() => void model.refresh()}
        />
        {state.items.map((post) => {
          const name =
            (post.userId && authorName(post.userId)) || common.member;
          return (
            <button
              type="button"
              className="mention-result"
              key={post.id}
              aria-disabled={!online || undefined}
              data-collection-post={post.id}
              aria-current={restore?.id === post.id || undefined}
              onClick={(e) => {
                if (online)
                  openRow(
                    post.id,
                    e.currentTarget,
                    list.current?.scrollTop ?? 0,
                  );
              }}
            >
              <span className="mention-avatar" aria-hidden="true">
                {Array.from(name)[0]}
              </span>
              <span className="mention-result-copy">
                <strong>
                  {name} · {channelName(post.channelId) || common.conversation}
                  {post.rootId &&
                    ` · ${common.reply.toLocaleLowerCase(language)}`}
                </strong>
                <MentionExcerpt message={post.message} cards={post.cards} />
              </span>
              {post.createAt !== undefined && (
                <time dateTime={new Date(post.createAt).toISOString()}>
                  {date.format(post.createAt)}
                </time>
              )}
            </button>
          );
        })}
        {state.status === "ready" &&
          !state.items.length &&
          state.nextPage === null && (
            <PanelState
              variant="empty"
              title={text.empty}
              message={text.detail}
            />
          )}
        {!online && state.hasResponse && (
          <PanelState variant="stale" role="status" message={common.offline} />
        )}
        {state.status === "forbidden" && (
          <p role="alert">{common.unavailable}</p>
        )}
        {state.edge === "loading" && <p role="status">{common.next}</p>}
        {edgeFailed && (
          <p role="alert">
            {state.edge === "storage" ? common.storage : common.network}
          </p>
        )}
        {state.firstInaccessiblePostTime > 0 && (
          <p role="status">{common.unavailableHistory}</p>
        )}
        {online &&
          state.nextPage !== null &&
          state.status === "ready" &&
          state.edge !== "loading" && (
            <button
              ref={edge}
              className="collection-page-action"
              type="button"
              onClick={readNext}
            >
              {edgeFailed ? common.retry : text.more}
            </button>
          )}
      </CollectionScroll>
    </aside>
  );
}
