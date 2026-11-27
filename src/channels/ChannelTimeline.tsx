import {
  Component,
  createRef,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { PendingPost } from "../mattermost/account-delivery.ts";
import type {
  LocalChannelWindow,
  LocalPost,
} from "../mattermost/local-history.ts";
import type { TimelineMessage } from "./conversation-rows.ts";
import { TimelineDays } from "./TimelineDays.tsx";
import { type TimelineAuthor, TimelinePost } from "./TimelinePost.tsx";
import {
  measureTimeline,
  type TimelinePlace,
  type TimelineViewport,
} from "./timeline-viewport.ts";
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
  },
} as const;
type Direction = "older" | "newer";
export type TimelineProps = {
  viewport?: TimelineViewport;
  channelId: string;
  page: LocalChannelWindow | null;
  locale: keyof typeof copy;
  timeZone?: string;
  offline: boolean;
  inaccessibleBefore?: number;
  author: TimelineAuthor;
  onOpenThread?: (post: LocalPost) => void;
  openThreadPostId?: string;
  collapsedThreads?: boolean;
  address?: { requestId: number; anchorId: string };
  restoredPosition?: { requestId: number; place: TimelinePlace };
  onReadEdge?: (direction: Direction, postId: string) => void;
  messages?: readonly TimelineMessage[];
  renderOutgoing?: (post: PendingPost) => ReactNode;
  ownName?: string;
  localNotice?: ReactNode;
  waitingMessage?: string;
};

type ScrollProps = {
  channelId: string;
  label: string;
  children: ReactNode;
  viewport?: TimelineViewport;
  historical: boolean;
  hasRows: boolean;
  restoredPosition?: TimelineProps["restoredPosition"];
};
class TimelineScroller extends Component<ScrollProps> {
  private readonly pane = createRef<HTMLElement>();
  private readonly frame = createRef<HTMLDivElement>();
  private resize?: ResizeObserver;
  focusPost(id: string) {
    const pane = this.pane.current,
      row = pane?.querySelector<HTMLElement>(
        `[data-post-id="${CSS.escape(id)}"]`,
      );
    if (!pane || !row) return false;
    this.lastCorrection = undefined;
    row.focus({ preventScroll: true });
    const bounds = row.getBoundingClientRect();
    pane.scrollTop +=
      bounds.top -
      pane.getBoundingClientRect().top -
      (pane.clientHeight - bounds.height) / 2;
    return true;
  }
  private restoredRequest?: number;
  private hiddenPlace: TimelinePlace | null | undefined = null;
  private lastCorrection?: { top: number; remainder: number };

  componentDidMount() {
    const pane = this.pane.current;
    if (this.props.viewport) this.props.viewport.current = pane;
    const frame = this.frame.current;
    if (!pane || !frame) return;
    const size = frame.getBoundingClientRect();
    this.fitPane(pane, size);
    if (this.restoredRequest === undefined) pane.scrollTop = pane.scrollHeight;
    this.resize = new ResizeObserver(([entry]) => {
      if (!this.pane.current || !entry) return;
      this.fitPane(pane, entry.contentRect);
    });
    this.resize.observe(frame);
  }

  // Keep the old line wrapping until the reading position has been measured.
  // The outer frame gets its bounds from layout; only its observer sizes the scroller.
  private fitPane(pane: HTMLElement, { width, height }: DOMRectReadOnly) {
    if (!width || !height) return;
    const inline = `${width}px`;
    const block = `${height}px`;
    if (pane.style.width === inline && pane.style.height === block) return;
    const place = this.place(pane, this.props.historical);
    pane.style.width = inline;
    pane.style.height = block;
    this.restore(pane, place);
  }

  componentWillUnmount() {
    this.resize?.disconnect();
    if (this.props.viewport) this.props.viewport.current = null;
  }

  // Measure the previous DOM immediately before React replaces it. Scrolling itself needs no listener.
  getSnapshotBeforeUpdate(
    previous: ScrollProps,
  ): TimelinePlace | null | "hidden" {
    const pane = this.pane.current;
    if (!pane || previous.channelId !== this.props.channelId) return null;
    if (!pane.clientHeight) return "hidden";
    return this.place(pane, previous.historical);
  }

  private place(pane: HTMLElement, historical: boolean) {
    const place = measureTimeline(pane, !historical);
    return place.atBottom && !historical ? null : place;
  }

  componentDidUpdate(
    previous: ScrollProps,
    _state: unknown,
    snapshot: TimelinePlace | null | "hidden",
  ) {
    const pane = this.pane.current;
    if (previous.viewport !== this.props.viewport) {
      if (previous.viewport) previous.viewport.current = null;
      if (this.props.viewport) this.props.viewport.current = pane;
    }
    if (!pane) return;
    if (!pane.clientHeight) {
      // The compact frame hides the channel while its thread or navigation is visible.
      if (snapshot !== "hidden") this.hiddenPlace = snapshot;
      return;
    }
    const place = snapshot === "hidden" ? this.hiddenPlace : snapshot;
    this.hiddenPlace = undefined;
    if (place !== undefined) this.restore(pane, place);
  }

  private restore(pane: HTMLElement, place: TimelinePlace | null) {
    const restored = this.props.restoredPosition;
    if (restored && restored.requestId !== this.restoredRequest) {
      this.restoredRequest = restored.requestId;
      place = restored.place;
    }
    const correction = this.lastCorrection;
    this.lastCorrection = undefined;
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
        // WebKit quantizes scrollTop. Carry the unapplied fraction while the reader stays put.
        const remainder =
          correction?.top === place.top ? correction.remainder : 0;
        const desired =
          pane.scrollTop +
          row.getBoundingClientRect().top -
          top -
          anchor.offset +
          remainder;
        const target = Math.min(
          Math.max(0, desired),
          pane.scrollHeight - pane.clientHeight,
        );
        pane.scrollTop = target;
        const actual = pane.scrollTop;
        this.lastCorrection = { top: actual, remainder: target - actual };
        return;
      }
    }
    pane.scrollTop = place.top;
  }

  render() {
    return (
      <div className="timeline-frame" ref={this.frame}>
        <section
          className="timeline-scroll"
          data-latest={
            (!this.props.historical && this.props.hasRows) || undefined
          }
          // biome-ignore lint/a11y/noNoninteractiveTabindex: This scrollable region is a keyboard target for Page and arrow keys.
          tabIndex={0}
          ref={this.pane}
          aria-label={this.props.label}
        >
          {this.props.children}
        </section>
      </div>
    );
  }
}

export function ChannelTimeline({
  viewport,
  channelId,
  page,
  locale,
  timeZone,
  offline,
  inaccessibleBefore,
  author,
  onOpenThread,
  openThreadPostId,
  collapsedThreads,
  address,
  restoredPosition,
  onReadEdge,
  messages,
  renderOutgoing,
  ownName,
  localNotice,
  waitingMessage,
}: TimelineProps) {
  const scroller = useRef<TimelineScroller>(null);
  const positioned = useRef<number | null>(null);
  useEffect(() => {
    if (!address) {
      positioned.current = null;
      return;
    }
    if (
      positioned.current !== address.requestId &&
      page &&
      scroller.current?.focusPost(address.anchorId)
    )
      positioned.current = address.requestId;
  }, [address, page]);
  const text = copy[locale];
  const time = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
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
  const ordered: readonly TimelineMessage[] =
    messages ?? [...(page?.posts ?? [])].reverse();
  const empty =
    page?.older.kind === "end" && page.newer.kind === "end" && !limited;
  return (
    <div className="channel-timeline" data-surface="message">
      {offline && (
        <div className="timeline-status" role="status">
          {page ? text.savedOffline : text.offline}
        </div>
      )}
      <TimelineScroller
        ref={scroller}
        channelId={channelId}
        label={text.history}
        viewport={viewport}
        restoredPosition={restoredPosition}
        hasRows={ordered.length > 0}
        historical={!!page && page.newer.kind !== "end"}
      >
        {limited && <div className="timeline-limit">{text.limited}</div>}
        {boundary("older")}
        {localNotice}
        <TimelineDays
          messages={ordered}
          locale={locale}
          timeZone={timeZone}
          unknownDate={text.unknownDate}
        >
          {(post) => (
            <TimelinePost
              key={post.localId ?? post.id}
              post={post}
              highlighted={address?.anchorId === post.id}
              focusable={address?.anchorId === post.id}
              locale={locale}
              author={author}
              time={time}
              ownName={ownName}
              onOpenThread={onOpenThread}
              expanded={openThreadPostId === post.id}
              collapsedThreads={collapsedThreads}
            >
              {post.outgoing && renderOutgoing?.(post.outgoing)}
            </TimelinePost>
          )}
        </TimelineDays>
        {!ordered.length && (page || !limited) && (
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
