import {
  type MouseEvent,
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { PanelRetry, PanelState } from "./PanelState.tsx";
import { attachmentExcerpt } from "./post-attachment-cards.ts";
import { publishedPostSummary } from "./published-post-summary.ts";
import { formatReplyCount, type TimelineAuthor } from "./TimelinePost.tsx";
import type { ThreadInboxPlace } from "./thread-inbox.ts";
import { threadInboxCopy } from "./thread-inbox-copy.ts";
import type {
  ThreadInboxModel,
  ThreadInboxRow,
} from "./use-workspace-thread-inbox.ts";
import { workspaceCopy } from "./workspace-copy.ts";
import "./thread-inbox.css";

type State = ReturnType<ThreadInboxModel["getSnapshot"]>;
type ScrollPlace = ThreadInboxPlace["position"];

function listPlace(list: HTMLElement | null): ScrollPlace {
  if (!list) return { top: 0, offset: 0 };
  const top = list.getBoundingClientRect().top;
  const row = Array.from(
    list.querySelectorAll<HTMLElement>("[data-inbox-id]"),
  ).find((node) => node.getBoundingClientRect().bottom > top);
  return {
    top: list.scrollTop,
    id: row?.dataset.inboxId,
    offset: row ? row.getBoundingClientRect().top - top : 0,
  };
}
function restoreList(list: HTMLElement, place?: ScrollPlace) {
  const row = place?.id
    ? list.querySelector<HTMLElement>(`[data-inbox-id="${place.id}"]`)
    : null;
  if (row && place)
    list.scrollTop +=
      row.getBoundingClientRect().top -
      list.getBoundingClientRect().top -
      place.offset;
  else list.scrollTop = place?.top ?? 0;
}
const tabs = ["followed", "unread"] as const;
const Summary = memo(function Summary({
  post,
  locale,
}: {
  post: NonNullable<ThreadInboxRow["post"]>;
  locale: EntryLanguage;
}) {
  const value = useMemo(
    () =>
      publishedPostSummary({
        message: post.message,
        cards: post.cards ?? post.excerptCards,
      }) ?? attachmentExcerpt(post.attachments, locale),
    [post, locale],
  );
  return (
    <span className="inbox-excerpt panel-text--body">
      {value || threadInboxCopy[locale].post}
    </span>
  );
});

export function ThreadInboxPane({
  model,
  state,
  online = true,
  selected,
  restoring,
  choose,
  place,
  capture,
  locale,
  author,
  channel,
}: {
  model: ThreadInboxModel;
  state: State;
  online?: boolean;
  selected?: string;
  restoring?: boolean;
  choose: (row: ThreadInboxRow) => void;
  place?: ThreadInboxPlace;
  capture?: (place: ThreadInboxPlace) => void;
  locale: EntryLanguage;
  author: TimelineAuthor;
  channel: (id: string) => string | undefined;
}) {
  const { tab, page, totals } = state;
  const text = threadInboxCopy[locale],
    workspace = workspaceCopy[locale];
  const prefix = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const edge = useRef<HTMLDivElement>(null);
  const scroll = useRef<Partial<Record<State["tab"], ScrollPlace>>>({});
  const restore = useRef<{
    tab: State["tab"];
    existing: Set<string>;
    control: HTMLElement;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const dates = useMemo(
    () => ({
      day: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }),
      time: new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
      }),
    }),
    [locale],
  );
  const rows = useMemo(
    () => (page.rows ?? []).filter((row) => row.post),
    [page.rows],
  );
  const origin = useRef<ThreadInboxPlace | null>(null);
  const restored = useRef<ThreadInboxPlace | undefined>(undefined);
  useLayoutEffect(() => {
    if (place && restored.current !== place) {
      restored.current = place;
      origin.current = place;
    }
    if (place && selected && tab === place.tab && page.status === "ready") {
      if (scroller.current) restoreList(scroller.current, place.position);
    }
  }, [place, selected, tab, page.status]);
  function openRow(row: ThreadInboxRow, index: number) {
    if (!origin.current) {
      const rawIndex = page.rows?.findIndex((item) => item.id === row.id);
      origin.current = {
        tab,
        id: row.id,
        index,
        // Include the next row so the old position still has a neighbor if the opener disappears.
        restoreRowLimit: Math.max(index, rawIndex ?? index) + 2,
        position: listPlace(scroller.current),
      };
    }
    capture?.(origin.current);
    choose(row);
  }
  useLayoutEffect(() => {
    const place = origin.current;
    if (selected || restoring || !place) return;
    if (place.tab !== tab) {
      void model.show(place.tab);
      return;
    }
    if (page.status === "idle" || page.status === "loading") return;
    origin.current = null;
    const list = scroller.current;
    queueMicrotask(() => {
      if (!list?.isConnected) return;
      restoreList(list, place.position);
      const target =
        rows.find((row) => row.id === place.id) ??
        rows[Math.min(place.index, rows.length - 1)];
      (target
        ? list.querySelector<HTMLElement>(`[data-inbox-id="${target.id}"]`)
        : document.getElementById(`${prefix}-${tab}`)
      )?.focus({ preventScroll: true });
    });
  }, [model, page.status, rows, selected, restoring, tab, prefix]);
  const error = !["idle", "loading", "ready"].includes(page.status);
  const countsError =
    totals.status === "network" || totals.status === "storage";
  const retryCounts = useRef<HTMLButtonElement>(null);
  const retrying = useRef(false);
  const tabsNode = useRef<HTMLDivElement>(null);
  const countsPending = totals.status === "loading" || totals.status === "idle";
  const countsMessage = countsError
    ? [
        totals.value ? text.countsRefreshError : text.countsInitialError,
        totals.serverError
          ? text.countsServer
          : !online
            ? text.countsOffline
            : totals.status === "storage"
              ? workspace.storage
              : "",
      ]
        .filter(Boolean)
        .join(" ")
    : countsPending
      ? totals.value
        ? text.countsRefreshing
        : text.countsLoading
      : "";
  useLayoutEffect(() => {
    if (countsPending || !retrying.current) return;
    if (
      !countsError &&
      (document.activeElement === retryCounts.current ||
        document.activeElement === document.body)
    )
      tabsNode.current
        ?.querySelector<HTMLElement>("[aria-selected=true]")
        ?.focus({ preventScroll: true });
    retrying.current = false;
  }, [countsPending, countsError]);
  function switchTo(next: State["tab"]) {
    if (next === tab) return;
    scroll.current[tab] = listPlace(scroller.current);
    restore.current = null;
    setNotice("");
    void model.show(next);
  }
  useLayoutEffect(() => {
    if (scroller.current) restoreList(scroller.current, scroll.current[tab]);
  }, [tab]);
  useEffect(() => {
    const node = edge.current;
    if (!node || !rows.length || !page.nextBefore || page.status !== "ready")
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          model.getSnapshot().tab === tab
        )
          void model.loadMore();
      },
      { root: scroller.current },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [model, tab, page.nextBefore, page.status, rows.length]);
  useLayoutEffect(() => {
    const saved = restore.current;
    if (!saved || saved.tab !== tab || page.status === "loading") return;
    restore.current = null;
    const panel = scroller.current;
    if (
      !panel ||
      (!panel.contains(document.activeElement) &&
        document.activeElement !== document.body)
    )
      return;
    if (error) {
      edge.current?.querySelector("button")?.focus();
      return;
    }
    const next = rows.find((row) => !saved.existing.has(row.id));
    const target = next
      ? panel.querySelector<HTMLButtonElement>(`[data-inbox-id="${next.id}"]`)
      : null;
    if (target) target.focus();
    else if (!saved.control.isConnected)
      (
        panel.querySelector<HTMLButtonElement>("li:last-child button") ?? panel
      ).focus();
    if (!page.nextBefore) setNotice(text.end);
  }, [page.status, page.nextBefore, rows, tab, error, text.end]);
  const reason =
    page.status === "forbidden" ||
    page.status === "unauthorized" ||
    page.status === "session"
      ? workspace.forbidden
      : page.status === "storage"
        ? workspace.storage
        : workspace.network;
  const firstPage = page.rows === null;
  const offline = page.status === "network" && !online;
  function readPage(event: MouseEvent<HTMLButtonElement>) {
    if (document.activeElement === event.currentTarget) {
      restore.current = {
        tab,
        existing: new Set(rows.map((row) => row.id)),
        control: event.currentTarget,
      };
      edge.current?.focus({ preventScroll: true });
    }
    if (error) void model.retryPage();
    else void model.loadMore();
  }
  return (
    <div className="thread-inbox">
      <div
        ref={tabsNode}
        role="tablist"
        aria-label={text.title}
        className="inbox-tabs panel-tabs"
      >
        {tabs.map((item) => (
          <button
            type="button"
            className="panel-tabs__tab"
            key={item}
            role="tab"
            id={`${prefix}-${item}`}
            tabIndex={tab === item ? 0 : -1}
            aria-selected={tab === item}
            aria-controls={`${prefix}-page`}
            aria-label={
              item === "unread" && totals.value?.totalUnreadThreads
                ? `${text.unread}, ${text.discussions}: ${totals.value.totalUnreadThreads}`
                : undefined
            }
            onClick={() => switchTo(item)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "followed"
                  : event.key === "End"
                    ? "unread"
                    : item === "followed"
                      ? "unread"
                      : "followed";
              document.getElementById(`${prefix}-${next}`)?.focus();
              switchTo(next);
            }}
          >
            {text[item]}
            {item === "unread" &&
              totals.value &&
              totals.value.totalUnreadThreads > 0 && (
                <span className="inbox-total" aria-hidden="true">
                  {totals.value.totalUnreadThreads}
                </span>
              )}
          </button>
        ))}
      </div>
      <div className="inbox-count-status" hidden={!countsMessage}>
        <span role="status">{countsMessage}</span>
        {(countsError || (countsPending && retrying.current)) && (
          <button
            ref={retryCounts}
            type="button"
            aria-label={text.countsRetry}
            aria-disabled={countsPending}
            aria-busy={countsPending}
            onClick={() => {
              if (countsPending) return;
              retrying.current = true;
              void model.refreshTotals();
            }}
          >
            {countsPending ? text.retrying : workspace.retry}
          </button>
        )}
      </div>
      <div
        ref={scroller}
        role="tabpanel"
        tabIndex={-1}
        id={`${prefix}-page`}
        aria-labelledby={`${prefix}-${tab}`}
        className="inbox-scroll"
      >
        {!!rows.length && (
          <ul className="inbox-rows">
            {rows.map((row, index) => {
              const post = row.post;
              if (!post) return null;
              const time = new Date(row.lastReplyAt);
              const profile = author(post.userId);
              const name = profile?.name ?? text.person;
              const room = channel(post.channelId);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    className="inbox-entry"
                    data-inbox-id={row.id}
                    aria-current={selected === row.id ? "true" : undefined}
                    data-unread={row.unreadReplies > 0 || undefined}
                    onClick={() => openRow(row, index)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
                        return;
                      event.preventDefault();
                      const next =
                        rows[index + (event.key === "ArrowDown" ? 1 : -1)];
                      if (next) {
                        scroller.current
                          ?.querySelector<HTMLButtonElement>(
                            `[data-inbox-id="${next.id}"]`,
                          )
                          ?.focus();
                        openRow(next, rows.indexOf(next));
                      } else if (event.key === "ArrowDown" && page.nextBefore) {
                        edge.current?.scrollIntoView({ block: "nearest" });
                        if (page.status === "ready") void model.loadMore();
                      }
                    }}
                  >
                    <span
                      className="timeline-avatar inbox-author"
                      aria-hidden="true"
                    >
                      {profile ? (profile.avatar ?? Array.from(name)[0]) : "•"}
                    </span>
                    <span className="inbox-row-heading">
                      {(row.unreadMentions > 0 || row.unreadReplies > 0) && (
                        <span className="inbox-row-indicator">
                          {row.unreadMentions > 0 ? (
                            <span
                              className="inbox-mention-count"
                              data-over={row.unreadMentions > 99 || undefined}
                              role="img"
                              aria-label={workspace.formatMentions(
                                row.unreadMentions,
                              )}
                            >
                              {row.unreadMentions > 99
                                ? "99+"
                                : row.unreadMentions}
                            </span>
                          ) : (
                            <span
                              className="inbox-unread-dot"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                      )}
                      <strong className="panel-text--author">{name}</strong>
                      {row.lastReplyAt > 0 &&
                        Number.isFinite(time.getTime()) && (
                          <time
                            className="panel-text--secondary"
                            dateTime={time.toISOString()}
                          >
                            {(time.toDateString() === new Date().toDateString()
                              ? dates.time
                              : dates.day
                            ).format(time)}
                          </time>
                        )}
                    </span>
                    <Summary post={post} locale={locale} />
                    <span className="inbox-replies panel-text--secondary">
                      <span
                        className="timeline-participants"
                        aria-hidden="true"
                      >
                        {row.participantIds.slice(0, 3).map((id) => {
                          const person = author(id);
                          return (
                            person && (
                              <span className="timeline-avatar" key={id}>
                                {person.avatar ?? Array.from(person.name)[0]}
                              </span>
                            )
                          );
                        })}
                      </span>
                      {row.unreadReplies > 0 ? (
                        <strong>{text.newReplies(row.unreadReplies)}</strong>
                      ) : row.replyCount ? (
                        formatReplyCount(row.replyCount, locale)
                      ) : (
                        text.noReplies
                      )}
                      {room && (
                        <span className="inbox-channel panel-text--secondary">
                          · {room}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {page.status === "ready" && !rows.length && (
          <PanelState
            variant="empty"
            role="status"
            title={
              page.rows?.length
                ? text.noRoots
                : tab === "unread"
                  ? text.noUnread
                  : text.empty
            }
          />
        )}
        {firstPage ? (
          error ? (
            <PanelState
              variant={offline ? "offline" : "error"}
              ref={edge}
              role="alert"
              title={offline ? workspace.offlineEmpty : text.firstError}
              message={offline ? text.offlineRetry : reason}
              action={
                <PanelRetry onClick={readPage}>{workspace.retry}</PanelRetry>
              }
            />
          ) : (
            <PanelState
              variant="pending"
              ref={edge}
              role="status"
              message={text.loading}
            />
          )
        ) : (
          (error || page.status === "loading" || page.nextBefore) && (
            <div ref={edge} className="inbox-status" tabIndex={-1}>
              <span role={error ? "alert" : "status"}>
                {error
                  ? `${text.moreError} ${reason}`
                  : page.status === "ready"
                    ? text.earlier
                    : text.loading}
              </span>
              {(error || (page.status === "ready" && page.nextBefore)) && (
                <button type="button" onClick={readPage}>
                  {error ? workspace.retry : text.more}
                </button>
              )}
            </div>
          )
        )}
        <span aria-live="polite" className="inbox-sr">
          {notice}
        </span>
      </div>
    </div>
  );
}
