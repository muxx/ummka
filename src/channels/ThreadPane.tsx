import {
  Component,
  createRef,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import {
  type NameFormat,
  teammateName,
} from "../mattermost/channel-profiles.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import type { TimelineMessage } from "./conversation-rows.ts";
import {
  formatReplyCount,
  type TimelineAuthor,
  TimelinePost,
} from "./TimelinePost.tsx";
import { openThreadReplyWindow } from "./thread-reply-window.ts";
import { useConversationOutgoing } from "./use-conversation-outgoing.tsx";
import { useWorkspaceProfiles } from "./use-workspace-profiles.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceCopy } from "./workspace-copy.ts";
import { workspaceFailure } from "./workspace-data.ts";
import "./thread-pane.css";

const copy = {
  en: {
    replies: "Replies",
    unknownDate: "Unknown date",
    loading: "Loading replies…",
    empty: "No replies yet.",
    up: "Earlier replies haven’t been loaded.",
    down: "Later replies haven’t been loaded.",
    gap: "Replies between these messages haven’t been loaded.",
    gapError: "Couldn’t load the replies between these messages.",
    more: "Show replies",
    upError: "Couldn’t load earlier replies.",
    downError: "Couldn’t load later replies.",
    unavailable: "This thread is no longer available.",
    limited: "This thread is outside the server’s available history.",
    noRoot: "The original message hasn’t been saved on this device.",
  },
  ru: {
    replies: "Ответы",
    unknownDate: "Дата неизвестна",
    loading: "Загружаем ответы…",
    empty: "Пока нет ответов.",
    up: "Ответы выше ещё не загружены.",
    down: "Ответы ниже ещё не загружены.",
    gap: "Ответы между этими ещё не загружены.",
    gapError: "Ответы между этими не загрузились.",
    more: "Показать ответы",
    upError: "Не удалось загрузить ответы выше.",
    downError: "Не удалось загрузить ответы ниже.",
    unavailable: "Это обсуждение больше недоступно.",
    limited: "Обсуждение за пределами доступной истории сервера.",
    noRoot: "Исходное сообщение ещё не сохранено на устройстве.",
  },
} as const;
type Reader = ReturnType<typeof openThreadReplyWindow>;
type WindowState = ReturnType<Reader["getSnapshot"]>;
type Direction = "up" | "down";
type Props = {
  connection: WorkspaceConnection;
  userId: string;
  post: LocalPost;
  collapsedThreads: boolean;
  locale: EntryLanguage;
  online: boolean;
  author: TimelineAuthor;
  nameFormat: NameFormat;
  sessionIssue: (issue: "session" | "unauthorized") => void;
  renderComposer: (rootId: string, reader: Reader) => ReactNode;
};

export function ThreadPane(props: Props) {
  const { connection, post, collapsedThreads } = props;
  const [reader, setReader] = useState<Reader | null>(null);
  useEffect(() => {
    const window = openThreadReplyWindow(
      connection,
      {
        channelId: post.channelId,
        rootId: post.rootId ?? post.id,
        collapsedThreads,
      },
      post.rootId ? post : undefined,
    );
    setReader(window);
    return () => window.close();
  }, [connection, post, collapsedThreads]);
  return reader ? <ThreadContent {...props} reader={reader} /> : null;
}

function ThreadContent({
  reader,
  collapsedThreads,
  connection,
  userId,
  post,
  online,
  locale,
  author,
  nameFormat,
  sessionIssue,
  renderComposer,
}: Props & { reader: Reader }) {
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  const [savedRoot, setSavedRoot] = useState<LocalPost | null>(null);
  const [localFailure, setLocalFailure] = useState<ReturnType<
    typeof workspaceFailure
  > | null>(null);
  const text = copy[locale];
  const workspace = workspaceCopy[locale];
  useEffect(() => {
    if (online) void reader.open();
  }, [online, reader]);
  const inaccessible =
    state.unavailable ??
    (localFailure === "session" ||
    localFailure === "unauthorized" ||
    localFailure === "forbidden"
      ? localFailure
      : undefined);
  useEffect(() => {
    if (inaccessible === "session" || inaccessible === "unauthorized")
      sessionIssue(inaccessible);
  }, [sessionIssue, inaccessible]);
  useEffect(() => {
    if (!post.rootId || inaccessible || state.root) return;
    let active = true;
    void connection.readSavedPost(post.channelId, post.rootId).then(
      (row) => {
        if (active) setSavedRoot(row);
      },
      (error) => {
        if (active) setLocalFailure(workspaceFailure(error, "storage"));
      },
    );
    return () => {
      active = false;
    };
  }, [connection, post, inaccessible, state.root]);
  const candidate = state.root ?? (post.rootId ? savedRoot : post);
  const root =
    !inaccessible &&
    candidate?.channelId === post.channelId &&
    candidate.id === (post.rootId ?? post.id) &&
    candidate.rootId === null
      ? candidate
      : null;
  const canReply =
    root !== null &&
    root.type !== "burn_on_read" &&
    root.type !== "system_fake_parent_deleted";
  const history = useMemo(() => [...state.replies].reverse(), [state.replies]);
  const outgoing = useConversationOutgoing({
    connection,
    userId,
    channelId: post.channelId,
    rootId: post.rootId ?? post.id,
    history,
    placement: state.down.status === "end" ? "timeline" : "afterGap",
    locale,
    enabled: canReply,
    sessionIssue,
  });
  const query = {
    ids: [
      ...new Set(
        [
          ...(root ? [root.userId] : []),
          ...state.replies.map((row) => row.userId),
        ].filter((id) => !author(id)),
      ),
    ],
    usernames: [],
  };
  const profiles = useWorkspaceProfiles(
    connection,
    query,
    online && !inaccessible,
    sessionIssue,
  );
  function resolve(id: string) {
    const person = profiles.profiles[id];
    return author(id) ?? (person && { name: teammateName(person, nameFormat) });
  }
  const dates = useMemo(
    () => ({
      time: new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
      }),
      day: new Intl.DateTimeFormat(locale, { dateStyle: "full" }),
    }),
    [locale],
  );
  if (inaccessible)
    return (
      <p className="timeline-empty" role="alert">
        {inaccessible === "limited" ? text.limited : text.unavailable}
      </p>
    );
  const summary =
    collapsedThreads && (post.rootId ? savedRoot : post)?.threadSummary;
  let lastDay: string | undefined;
  function renderReply(row: TimelineMessage) {
    const when = new Date(row.createAt);
    const day = Number.isFinite(when.getTime())
      ? dates.day.format(when)
      : text.unknownDate;
    const separated = day !== lastDay;
    lastDay = day;
    return (
      <div
        key={row.localId ?? row.id}
        className="thread-reply"
        data-selected={row.id === post.id || undefined}
      >
        {separated && (
          <div className="timeline-day">
            <span>{day}</span>
          </div>
        )}
        <TimelinePost
          post={row}
          focusable
          locale={locale}
          time={dates.time}
          author={resolve}
          ownName={outgoing.ownName}
        >
          {row.outgoing && outgoing.renderOutgoing(row.outgoing)}
        </TimelinePost>
      </div>
    );
  }
  const replyRows = [
    ...outgoing.messages.map(renderReply),
    <ThreadEdge
      key="down"
      reader={reader}
      direction="down"
      edge={state.down}
      online={online}
      locale={locale}
      gap={outgoing.afterGap.length > 0}
    />,
    ...outgoing.afterGap.map(renderReply),
  ];
  return (
    <div className="thread-window">
      <ThreadFeed
        focusedId={post.rootId ? post.id : undefined}
        state={state}
        label={text.replies}
      >
        {!online && (
          <p className="timeline-status" role="status">
            {workspace.offlineEmpty}
          </p>
        )}
        {root && (
          <div className="thread-root">
            <TimelinePost
              post={root}
              locale={locale}
              time={dates.time}
              author={resolve}
            />
          </div>
        )}
        {!root && !online && (
          <p className="timeline-empty">
            {localFailure === "storage" ? workspace.storage : text.noRoot}
          </p>
        )}
        {summary && summary.replyCount > 0 && (
          <p className="thread-count">
            {formatReplyCount(summary.replyCount, locale)}
          </p>
        )}
        <ThreadEdge
          reader={reader}
          direction="up"
          edge={state.up}
          online={online}
          locale={locale}
        />
        {outgoing.localNotice}
        {replyRows}
        {state.root &&
          state.up.status === "end" &&
          state.down.status === "end" &&
          !outgoing.messages.length && (
            <p className="timeline-empty">{text.empty}</p>
          )}
      </ThreadFeed>
      {canReply && renderComposer(root.id, reader)}
    </div>
  );
}

function ThreadEdge({
  reader,
  direction,
  edge,
  online,
  locale,
  gap = false,
}: {
  reader: Reader;
  direction: Direction;
  edge: WindowState[Direction];
  online: boolean;
  locale: EntryLanguage;
  gap?: boolean;
}) {
  const marker = useRef<HTMLDivElement>(null);
  const text = copy[locale];
  useEffect(() => {
    const target = marker.current;
    if (!online || edge.status !== "ready" || !target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          void reader.more(direction);
      },
      { root: target.closest(".thread-feed") },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [online, edge.status, direction, reader]);
  if (edge.status === "end") return null;
  const failed = edge.status === "error";
  const description =
    edge.status === "loading"
      ? text.loading
      : failed
        ? gap
          ? text.gapError
          : direction === "up"
            ? text.upError
            : text.downError
        : gap
          ? text.gap
          : text[direction];
  return (
    <div
      ref={marker}
      className="timeline-boundary thread-edge"
      data-thread-edge={direction}
      tabIndex={-1}
    >
      <span role="status">{description}</span>
      {online && (failed || edge.status === "ready") && (
        <button
          type="button"
          aria-label={
            description +
            " " +
            (failed ? workspaceCopy[locale].retry : text.more)
          }
          onClick={(event) => {
            if (event.detail === 0)
              marker.current?.focus({ preventScroll: true });
            if (failed) void reader.retry(direction);
            else void reader.more(direction);
          }}
        >
          {failed ? workspaceCopy[locale].retry : text.more}
        </button>
      )}
    </div>
  );
}

type FeedProps = {
  state: WindowState;
  focusedId?: string;
  label: string;
  children: ReactNode;
};
type Place = { top: number; id?: string; offset?: number; edge?: Direction };

class ThreadFeed extends Component<FeedProps> {
  private readonly pane = createRef<HTMLElement>();

  private positionOpeningReply = true;
  private markUserScroll = () => {
    this.positionOpeningReply = false;
  };

  componentDidMount() {
    this.centerOpeningReply(true);
  }

  private centerOpeningReply(focus: boolean) {
    const pane = this.pane.current;
    if (!pane || !this.props.focusedId) return;
    const row = pane.querySelector<HTMLElement>(
      `[data-post-id="${this.props.focusedId}"]`,
    );
    if (row && (focus || document.activeElement === row)) {
      if (focus) row.focus({ preventScroll: true });
      const bounds = row.getBoundingClientRect();
      pane.scrollTop +=
        bounds.top -
        pane.getBoundingClientRect().top -
        (pane.clientHeight - bounds.height) / 2;
    }
  }
  getSnapshotBeforeUpdate(): Place | null {
    const pane = this.pane.current;
    if (!pane) return null;
    const bounds = pane.getBoundingClientRect();
    const focused = document.activeElement;
    const edge =
      focused instanceof HTMLElement && pane.contains(focused)
        ? focused.closest<HTMLElement>("[data-thread-edge]")?.dataset.threadEdge
        : undefined;
    const place: Place = {
      top: pane.scrollTop,
      edge: edge === "up" || edge === "down" ? edge : undefined,
    };
    if (pane.scrollTop === 0 && !this.props.focusedId && !edge) return place;
    const items = pane.querySelectorAll<HTMLElement>(
      ".thread-reply [data-post-id]",
    );
    for (const row of items) {
      const box = row.getBoundingClientRect();
      if (box.top >= bounds.bottom) break;
      if (box.bottom > bounds.top) {
        return {
          ...place,
          id: row.dataset.postId,
          offset: box.top - bounds.top,
        };
      }
    }
    return place;
  }
  componentDidUpdate(
    previous: FeedProps,
    _state: unknown,
    place: Place | null,
  ) {
    const pane = this.pane.current;
    if (!pane || !place) return;
    const row =
      place.id &&
      pane.querySelector<HTMLElement>(
        `[data-post-id="${CSS.escape(place.id)}"],[data-local-id="${CSS.escape(place.id)}"]`,
      );
    if (row)
      pane.scrollTop +=
        row.getBoundingClientRect().top -
        pane.getBoundingClientRect().top -
        (place.offset ?? 0);
    else pane.scrollTop = place.top;
    const { state } = this.props;
    if (
      this.positionOpeningReply &&
      (previous.state.up.status === "loading" ||
        previous.state.down.status === "loading")
    ) {
      this.centerOpeningReply(false);
      if (state.up.status !== "loading" && state.down.status !== "loading")
        this.positionOpeningReply = false;
    }
    const { edge } = place;
    if (
      !edge ||
      previous.state[edge].status !== "loading" ||
      state[edge].status === "loading"
    )
      return;
    if (state[edge].status === "error") {
      pane
        .querySelector<HTMLButtonElement>(`[data-thread-edge="${edge}"] button`)
        ?.focus({ preventScroll: true });
      return;
    }
    // Restore keyboard focus to the reply next to the old boundary, even when
    // both page reads settle in the same render.
    const old =
      edge === "up" ? previous.state.replies[0] : previous.state.replies.at(-1);
    const oldIndex =
      old && state.replies.findIndex((post) => post.id === old.id);
    const nearest =
      oldIndex !== undefined && oldIndex >= 0
        ? (state.replies[oldIndex + (edge === "up" ? -1 : 1)] ?? old)
        : edge === "up"
          ? state.replies.at(-1)
          : state.replies[0];
    const target = nearest
      ? pane.querySelector<HTMLElement>(`[data-post-id="${nearest.id}"]`)
      : pane;
    target?.focus({ preventScroll: true });
  }
  render() {
    return (
      <section
        ref={this.pane}
        onPointerDown={this.markUserScroll}
        onWheel={this.markUserScroll}
        onKeyDown={this.markUserScroll}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users can page through this independently scrollable thread.
        tabIndex={0}
        className="timeline-scroll thread-feed"
        aria-label={this.props.label}
      >
        {this.props.children}
      </section>
    );
  }
}
