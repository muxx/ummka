import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { CollectionScroll } from "./CollectionScroll.tsx";
import { collectionCopy } from "./collection-copy.ts";
import type { openMentionList } from "./mention-list.ts";
import { publishedPostDocument } from "./published-post-document.ts";
import { publishedPostExcerpt } from "./published-post-excerpt.ts";
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
    wide: "Expand panel",
    narrow: "Restore narrow panel",
  },
  ru: {
    title: "Упоминания",
    back: "К упоминаниям",
    empty: "Упоминаний пока нет",
    detail: "Здесь появятся обращения к вам и ко всему каналу.",
    more: "Загрузить более ранние упоминания",
    close: "Закрыть панель",
    wide: "Развернуть панель",
    narrow: "Вернуть узкую панель",
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
function PanelGlyph({ path }: { path: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const MentionExcerpt = memo(function MentionExcerpt({
  message,
}: {
  message: string;
}) {
  return (
    <small>{publishedPostExcerpt(publishedPostDocument({ message }))}</small>
  );
});

export function MentionsPane({
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
  sessionIssue,
}: {
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
  sessionIssue: (issue: "session" | "unauthorized") => void;
}) {
  const text = mentionCopy[language],
    common = collectionCopy[language];
  const [wide, setWide] = useState(false);
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const edge = useRef<HTMLButtonElement>(null);
  const focusedPage = useRef<number | null>(null);
  const readNext = useCallback(() => {
    if (edge.current && document.activeElement === edge.current)
      focusedPage.current = state.items.length;
    void model.load();
  }, [model, state.items.length]);
  useLayoutEffect(() => {
    const index = focusedPage.current;
    if (index === null || state.status === "loading") return;
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
    const row = initial.current;
    const target =
      row &&
      list.current?.querySelector<HTMLElement>(
        `[data-collection-post="${CSS.escape(row.id)}"]`,
      );
    if (row && list.current && target) {
      list.current.scrollTop = row.scroll;
      target.focus({ preventScroll: true });
    } else heading.current?.focus();
  }, []);
  useEffect(() => {
    if (state.status === "session" || state.status === "unauthorized")
      sessionIssue(state.status);
  }, [sessionIssue, state.status]);
  useEffect(() => {
    if (
      !online ||
      state.status !== "ready" ||
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
  }, [online, readNext, state.status, state.nextPage]);
  const date = useMemo(
    () => new Intl.DateTimeFormat(language, { day: "numeric", month: "long" }),
    [language],
  );
  const failed = state.status === "network" || state.status === "storage";
  return (
    <aside
      className="mentions-pane"
      data-wide={wide || undefined}
      data-standalone={standalone || undefined}
      aria-labelledby={id}
    >
      <header className="channels-pane-head mentions-head">
        <button
          type="button"
          className="channels-icon-action mentions-mobile-back"
          aria-label={text.close}
          onClick={close}
        >
          <PanelGlyph path="m12 5-7 7 7 7M5 12h15" />
        </button>
        <div className="mentions-heading">
          <div>
            <MentionMark />
            <h2 ref={heading} tabIndex={-1} id={id}>
              {text.title}
            </h2>
          </div>
          <p>{team}</p>
        </div>
        {!standalone && (
          <button
            type="button"
            className="channels-icon-action mentions-desktop-action"
            aria-label={wide ? text.narrow : text.wide}
            title={wide ? text.narrow : text.wide}
            onClick={() => setWide(!wide)}
          >
            <PanelGlyph
              path={
                wide
                  ? "M4 9h5V4m6 16v-5h5M4 4l5 5m11 11-5-5"
                  : "M4 9V4h5m6 16h5v-5M4 4l6 6m10 10-6-6"
              }
            />
          </button>
        )}
        <button
          type="button"
          className="channels-icon-action mentions-desktop-action"
          aria-label={text.close}
          title={text.close}
          onClick={close}
        >
          <PanelGlyph path="m6 6 12 12M18 6 6 18" />
        </button>
      </header>
      <CollectionScroll pane={list}>
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
                </strong>
                <MentionExcerpt message={post.message || ""} />
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
            <div className="mentions-empty">
              <MentionMark />
              <h3>{text.empty}</h3>
              <p>{text.detail}</p>
            </div>
          )}
        {!online && <p role="status">{common.offline}</p>}
        {online && (state.status === "loading" || state.status === "idle") && (
          <p role="status">{common.loading}</p>
        )}
        {state.status === "forbidden" && (
          <p role="alert">{common.unavailable}</p>
        )}
        {failed && (
          <p role="alert">
            {state.status === "storage" ? common.storage : common.network}
          </p>
        )}
        {state.firstInaccessiblePostTime > 0 && (
          <p role="status">{common.unavailableHistory}</p>
        )}
        {online &&
          state.nextPage !== null &&
          (state.status === "ready" || failed) && (
            <button
              ref={edge}
              className="collection-page-action"
              type="button"
              onClick={readNext}
            >
              {failed ? common.retry : text.more}
            </button>
          )}
      </CollectionScroll>
    </aside>
  );
}
