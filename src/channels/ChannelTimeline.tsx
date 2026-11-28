import { Component, createRef, type ReactNode, useEffect, useRef } from "react";
import type { PendingPost } from "../mattermost/account-delivery.ts";
import type {
  LocalChannelWindow,
  LocalPost,
} from "../mattermost/local-history.ts";
import type { TimelineMessage } from "./conversation-rows.ts";
import { HistoryPageEdge, historyPageError } from "./HistoryPageEdge.tsx";
import { showPostArrival } from "./post-arrival.ts";
import { TimelineDays } from "./TimelineDays.tsx";
import {
  type TimelineAuthor,
  TimelinePost,
  useTimelinePostFormat,
} from "./TimelinePost.tsx";
import { createTimelinePostTouch } from "./timeline-post-touch.ts";
import type {
  TimelineDirection,
  TimelineEdgeReads,
} from "./timeline-reader.ts";
import {
  measureTimeline,
  restoreTimelineAnchor,
  type TimelinePlace,
  type TimelineScrollCorrection,
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
    loading: "Loading messages…",
    failed: {
      older: "Couldn’t load earlier messages",
      newer: "Couldn’t load later messages",
    },
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
    loading: "Загружаем ленту…",
    failed: {
      older: "Лента выше не загрузилась",
      newer: "Лента ниже не загрузилась",
    },
    older: "Лента выше ещё не загружена.",
    newer: "Лента ниже ещё не загружена.",
    readOlder: "Показать более ранние сообщения",
    readNewer: "Показать более новые сообщения",
  },
} as const;
const noEdgeReads: TimelineEdgeReads = {};
const edgeLoading = (edges: TimelineEdgeReads) =>
  edges.older?.status === "loading" || edges.newer?.status === "loading";
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
  edgeReads?: TimelineEdgeReads;
  onReadEdge?: (direction: TimelineDirection, postId: string) => void;
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
  page: LocalChannelWindow | null;
  edgeReads: TimelineEdgeReads;
  hasRows: boolean;
  restoredPosition?: TimelineProps["restoredPosition"];
};
type ScrollSnapshot = {
  place: TimelinePlace | null;
  edge?: TimelineDirection;
};

class TimelineScroller extends Component<ScrollProps> {
  private readonly pane = createRef<HTMLElement>();
  private readonly postTouch = createTimelinePostTouch();
  private readonly frame = createRef<HTMLDivElement>();
  private resize?: ResizeObserver;
  private clearArrival?: () => void;
  cancelArrival() {
    this.clearArrival?.();
    this.clearArrival = undefined;
  }
  focusPost(id: string) {
    this.cancelArrival();
    const pane = this.pane.current,
      row = pane?.querySelector<HTMLElement>(
        `[data-post-id="${CSS.escape(id)}"]`,
      );
    if (!pane || !row) return false;
    this.lastCorrection = undefined;
    this.followedEndAt = undefined;
    row.focus({ preventScroll: true });
    const bounds = row.getBoundingClientRect();
    pane.scrollTop +=
      bounds.top -
      pane.getBoundingClientRect().top -
      (pane.clientHeight - bounds.height) / 2;
    this.clearArrival = showPostArrival(row);
    return true;
  }
  private restoredRequest?: number;
  private hiddenPlace: TimelinePlace | null | undefined = null;
  private lastCorrection?: TimelineScrollCorrection;
  private followedEndAt?: number;

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
    const place = this.place(
      pane,
      this.props.historical || edgeLoading(this.props.edgeReads),
    );
    pane.style.width = inline;
    pane.style.height = block;
    this.restore(pane, place);
  }

  componentWillUnmount() {
    this.cancelArrival();
    this.resize?.disconnect();
    if (this.props.viewport) this.props.viewport.current = null;
  }

  // Measure the previous DOM immediately before React replaces it. Scrolling itself needs no listener.
  getSnapshotBeforeUpdate(previous: ScrollProps): ScrollSnapshot | "hidden" {
    const pane = this.pane.current;
    if (!pane || previous.channelId !== this.props.channelId)
      return { place: null };
    if (!pane.clientHeight) return "hidden";
    const focused = document.activeElement;
    const direction =
      focused instanceof HTMLElement && pane.contains(focused)
        ? focused.dataset.channelEdge
        : undefined;
    return {
      place: this.place(
        pane,
        previous.historical ||
          edgeLoading(previous.edgeReads) ||
          edgeLoading(this.props.edgeReads),
      ),
      edge:
        direction === "older" || direction === "newer" ? direction : undefined,
    };
  }

  private place(pane: HTMLElement, historical: boolean) {
    const place = measureTimeline(pane, !historical);
    // Content can grow before React's next update while the scrollTop stays
    // where the reader last followed the end.
    if (
      !historical &&
      (place.atBottom ||
        (this.followedEndAt !== undefined &&
          Math.abs(place.top - this.followedEndAt) <= 2))
    )
      return null;
    this.followedEndAt = undefined;
    return place;
  }

  componentDidUpdate(
    previous: ScrollProps,
    _state: unknown,
    snapshot: ScrollSnapshot | "hidden",
  ) {
    const pane = this.pane.current;
    if (previous.viewport !== this.props.viewport) {
      if (previous.viewport) previous.viewport.current = null;
      if (this.props.viewport) this.props.viewport.current = pane;
    }
    if (!pane) return;
    if (!pane.clientHeight) {
      // The compact frame hides the channel while its thread or navigation is visible.
      if (snapshot !== "hidden") this.hiddenPlace = snapshot.place;
      return;
    }
    const place = snapshot === "hidden" ? this.hiddenPlace : snapshot.place;
    this.hiddenPlace = undefined;
    if (place !== undefined) this.restore(pane, place);
    if (snapshot !== "hidden" && snapshot.edge)
      this.restoreEdgeFocus(pane, snapshot.edge, previous);
  }

  private restoreEdgeFocus(
    pane: HTMLElement,
    direction: TimelineDirection,
    previous: ScrollProps,
  ) {
    const { page, edgeReads } = this.props;
    const read = edgeReads[direction];
    if (read?.status === "loading") return;
    if (read?.status === "error") {
      pane
        .querySelector<HTMLButtonElement>(
          `[data-channel-edge="${direction}"] button`,
        )
        ?.focus({ preventScroll: true });
      return;
    }
    if (!page || page === previous.page) return;
    const older = direction === "older";
    const boundary = older
      ? previous.page?.posts.at(-1)
      : previous.page?.posts[0];
    const index = page.posts.findIndex((post) => post.id === boundary?.id);
    const nearest =
      index < 0
        ? undefined
        : (page.posts[index + (older ? 1 : -1)] ?? boundary);
    const row =
      nearest &&
      pane.querySelector<HTMLElement>(
        `[data-post-id="${CSS.escape(nearest.id)}"]`,
      );
    (row || pane).focus({ preventScroll: true });
  }

  private restore(pane: HTMLElement, place: TimelinePlace | null) {
    const restored = this.props.restoredPosition;
    const returning = restored && restored.requestId !== this.restoredRequest;
    if (returning) {
      this.restoredRequest = restored.requestId;
      place = restored.place;
    }
    const correction = this.lastCorrection;
    this.lastCorrection = undefined;
    if (!place || (place.atBottom && !place.anchors.length)) {
      pane.scrollTop = pane.scrollHeight;
      if (returning || this.followedEndAt !== undefined)
        this.followedEndAt = pane.scrollTop;
      return;
    }
    this.followedEndAt = undefined;
    for (const anchor of place.anchors) {
      const row = pane.querySelector<HTMLElement>(
        `[data-post-id="${CSS.escape(anchor.id)}"],[data-local-id="${CSS.escape(anchor.id)}"]`,
      );
      if (row) {
        this.lastCorrection = restoreTimelineAnchor(
          pane,
          row,
          { top: place.top, offset: anchor.offset },
          correction,
        );
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
          {...this.postTouch}
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
  edgeReads = noEdgeReads,
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
      scroller.current?.cancelArrival();
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
  const time = useTimelinePostFormat(locale, timeZone);
  const limited = Boolean(
    inaccessibleBefore || page?.firstInaccessiblePostTime,
  );
  function boundary(direction: TimelineDirection) {
    const edge = page?.[direction];
    if (!edge || edge.kind === "end") return null;
    const read = edgeReads[direction];
    const action =
      edge.kind === "more" && onReadEdge
        ? {
            label: direction === "older" ? text.readOlder : text.readNewer,
            disabled: edgeLoading(edgeReads),
            run: () => onReadEdge(direction, edge.postId),
          }
        : undefined;
    const description =
      read?.status === "loading"
        ? text.loading
        : read?.status === "error"
          ? historyPageError(locale, text.failed[direction], read.reason)
          : action
            ? undefined
            : text[direction];
    return (
      <HistoryPageEdge
        direction={direction}
        locale={locale}
        description={description}
        loading={read?.status === "loading"}
        failed={read?.status === "error"}
        action={action}
      />
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
        page={page}
        edgeReads={edgeReads}
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
          author={author}
          unknownDate={text.unknownDate}
        >
          {(post, continuation) => (
            <TimelinePost
              key={post.localId ?? post.id}
              post={post}
              continuation={continuation}
              addressed={address?.anchorId === post.id}
              focusable
              locale={locale}
              author={author}
              time={time.clock}
              menuDate={time}
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
          <p
            className={
              waitingMessage === undefined
                ? "timeline-empty"
                : "timeline-empty panel-text--secondary"
            }
          >
            {waitingMessage ??
              (!page ? text.cold : empty ? text.empty : text.partial)}
          </p>
        )}
        {boundary("newer")}
      </TimelineScroller>
    </div>
  );
}
