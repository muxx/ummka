import { Component, createRef, type ReactNode, useMemo } from "react";
import type { PendingPost } from "../mattermost/account-delivery.ts";
import type { LocalChannelWindow } from "../mattermost/local-history.ts";
import type { TimelineMessage } from "./conversation-rows.ts";
import "./timeline.css";

const copy = {
  en: {
    history: "Channel messages",
    offline: "Offline",
    savedOffline: "Offline · Saved on this device",
    unknownDate: "Unknown date",
    cold: "No history saved on this device yet.",
    empty: "There are no messages in this channel yet.",
    partial: "No messages in this part of the history.",
    limited: "Earlier messages are unavailable on this server.",
    older: "Earlier messages have not been loaded.",
    newer: "Later messages have not been loaded.",
    readOlder: "Show earlier messages",
    readNewer: "Show later messages",
    unknown: "Unknown user",
    edited: "edited",
    pinned: "Pinned",
  },
  ru: {
    history: "Сообщения канала",
    offline: "Без сети",
    savedOffline: "Без сети · Сохранено на устройстве",
    unknownDate: "Дата неизвестна",
    cold: "На устройстве ещё нет истории этого канала.",
    empty: "В этом канале пока нет сообщений.",
    partial: "В этом участке истории нет сообщений.",
    limited: "Более ранние сообщения недоступны на сервере.",
    older: "Лента выше ещё не загружена.",
    newer: "Лента ниже ещё не загружена.",
    readOlder: "Показать более ранние сообщения",
    readNewer: "Показать более новые сообщения",
    unknown: "Неизвестный пользователь",
    edited: "изменено",
    pinned: "Закреплено",
  },
} as const;
type Direction = "older" | "newer";
type Author = { name: string; avatar?: ReactNode };
export type TimelineProps = {
  channelId: string;
  page: LocalChannelWindow | null;
  locale: keyof typeof copy;
  timeZone?: string;
  offline: boolean;
  inaccessibleBefore?: number;
  author: (userId: string) => Author | undefined;
  onReadEdge?: (direction: Direction, postId: string) => void;
  messages?: readonly TimelineMessage[];
  renderOutgoing?: (post: PendingPost) => ReactNode;
  ownName?: string;
  localNotice?: ReactNode;
  waitingMessage?: string;
};

type ScrollProps = { channelId: string; label: string; children: ReactNode };
type Place = { top: number; anchors: { id: string; offset: number }[] };
class TimelineScroller extends Component<ScrollProps> {
  private readonly pane = createRef<HTMLElement>();

  componentDidMount() {
    const pane = this.pane.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }

  // Measure the previous DOM immediately before React replaces it. Scrolling itself needs no listener.
  getSnapshotBeforeUpdate(previous: ScrollProps): Place | null {
    const pane = this.pane.current;
    if (
      !pane ||
      previous.channelId !== this.props.channelId ||
      pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 2
    )
      return null;
    const bounds = pane.getBoundingClientRect();
    const anchors: Place["anchors"] = [];
    for (const row of pane.querySelectorAll<HTMLElement>("[data-post-id]")) {
      const box = row.getBoundingClientRect();
      if (box.top >= bounds.bottom) break;
      const id = row.dataset.postId;
      if (id && box.bottom > bounds.top)
        anchors.push({ id, offset: box.top - bounds.top });
    }
    return { top: pane.scrollTop, anchors };
  }

  componentDidUpdate(
    _previous: ScrollProps,
    _state: unknown,
    place: Place | null,
  ) {
    const pane = this.pane.current;
    if (!pane) return;
    if (!place) {
      pane.scrollTop = pane.scrollHeight;
      return;
    }
    const top = pane.getBoundingClientRect().top;
    for (const anchor of place.anchors) {
      const row = pane.querySelector<HTMLElement>(
        `[data-post-id="${CSS.escape(anchor.id)}"],[data-local-id="${CSS.escape(anchor.id)}"]`,
      );
      if (row) {
        pane.scrollTop += row.getBoundingClientRect().top - top - anchor.offset;
        return;
      }
    }
    pane.scrollTop = place.top;
  }

  render() {
    return (
      <section
        className="timeline-scroll"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: This scrollable region is a keyboard target for Page and arrow keys.
        tabIndex={0}
        ref={this.pane}
        aria-label={this.props.label}
      >
        {this.props.children}
      </section>
    );
  }
}

function initials(name: string) {
  const words = name.trim().split(/\s+/u);
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
  return (first + last).toLocaleUpperCase();
}

export function ChannelTimeline({
  channelId,
  page,
  locale,
  timeZone,
  offline,
  inaccessibleBefore,
  author,
  onReadEdge,
  messages,
  renderOutgoing,
  ownName,
  localNotice,
  waitingMessage,
}: TimelineProps) {
  const text = copy[locale];
  const dates = useMemo(
    () => ({
      day: new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone }),
      time: new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      }),
    }),
    [locale, timeZone],
  );
  const limited = Boolean(
    inaccessibleBefore || page?.firstInaccessiblePostTime,
  );
  function boundary(direction: Direction) {
    const edge = page?.[direction];
    if (!edge || edge.kind === "end") return null;
    const action = edge.kind === "more" && onReadEdge;
    return (
      <div className="timeline-boundary">
        {action ? (
          <button
            type="button"
            onClick={() => onReadEdge?.(direction, edge.postId)}
          >
            {direction === "older" ? text.readOlder : text.readNewer}
          </button>
        ) : (
          <span>{text[direction]}</span>
        )}
      </div>
    );
  }
  let previousDay = "";
  const rows: ReactNode[] = [];
  const ordered: readonly TimelineMessage[] =
    messages ?? [...(page?.posts ?? [])].reverse();
  for (const post of ordered) {
    const when = new Date(post.createAt);
    const dated = Number.isFinite(when.getTime());
    const day = dated ? dates.day.format(when) : text.unknownDate;
    if (day !== previousDay) {
      rows.push(
        <div key={`day-${post.id}`} className="timeline-day">
          <span>{day}</span>
        </div>,
      );
      previousDay = day;
    }
    const person = author(post.userId);
    const name = person?.name || (post.outgoing && ownName) || text.unknown;
    const delivery = post.outgoing && renderOutgoing?.(post.outgoing);
    rows.push(
      <article
        key={post.localId ?? post.id}
        className="timeline-post"
        data-post-id={post.id}
        data-local-id={post.localId}
      >
        <div className="timeline-avatar" aria-hidden="true">
          {person?.avatar ??
            (person?.name || (post.outgoing && ownName) ? initials(name) : "•")}
        </div>
        <div className="timeline-post-body">
          <header>
            <strong>{name}</strong>
            {dated && (
              <time dateTime={when.toISOString()}>
                {dates.time.format(when)}
              </time>
            )}
            {post.isPinned && (
              <span className="timeline-pin">{text.pinned}</span>
            )}
          </header>
          <p>
            {post.message}
            {post.editAt > 0 && (
              <small className="timeline-edited"> ({text.edited})</small>
            )}
          </p>
          {delivery}
        </div>
      </article>,
    );
  }
  const empty =
    page?.older.kind === "end" && page.newer.kind === "end" && !limited;
  return (
    <div className="channel-timeline" data-surface="message">
      {offline && (
        <div className="timeline-status" role="status">
          {page ? text.savedOffline : text.offline}
        </div>
      )}
      <TimelineScroller channelId={channelId} label={text.history}>
        {limited && <div className="timeline-limit">{text.limited}</div>}
        {boundary("older")}
        {localNotice}
        {rows}
        {!rows.length && (page || !limited) && (
          <p className="timeline-empty">
            {waitingMessage ??
              (!page ? text.cold : empty ? text.empty : text.partial)}
          </p>
        )}
        {boundary("newer")}
      </TimelineScroller>
    </div>
  );
}
