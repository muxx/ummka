import {
  Component,
  type CSSProperties,
  createRef,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
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
import type { ThreadReadVisit } from "../mattermost/thread-read-coordination.ts";
import type { TimelineMessage } from "./conversation-rows.ts";
import { HistoryPageEdge, historyPageError } from "./HistoryPageEdge.tsx";
import { showPostArrival } from "./post-arrival.ts";
import { ThreadFollowButton } from "./ThreadFollowButton.tsx";
import { TimelineDays } from "./TimelineDays.tsx";
import {
  formatReplyCount,
  type TimelineAuthor,
  TimelinePost,
  useTimelinePostFormat,
} from "./TimelinePost.tsx";
import { openThreadFollowControl } from "./thread-follow-control.ts";
import type { ParkedThreadWindow, ThreadReadingPlace } from "./thread-inbox.ts";
import { threadInboxCopy } from "./thread-inbox-copy.ts";
import { openThreadReplyWindow } from "./thread-reply-window.ts";
import { createTimelinePostTouch } from "./timeline-post-touch.ts";
import type { ChannelHistoryAccess } from "./timeline-reader.ts";
import {
  restoreTimelineAnchor,
  type TimelineScrollCorrection,
} from "./timeline-viewport.ts";
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
    gapError: "Couldn’t load the replies between these messages",
    more: "Show replies",
    upError: "Couldn’t load earlier replies",
    downError: "Couldn’t load later replies",
    unavailable: "This thread is no longer available.",
    limited: "This thread is outside the server’s available history.",
    noRoot: "The original message hasn’t been saved on this device.",
    viewUnconfirmed: "Couldn’t confirm the read status",
    viewCheck: "Check read status",
    viewChecking: "Checking read status…",
    viewCheckedRead: "Checked: the thread isn’t marked unread",
    viewCheckedUnread: "Checked: the thread is marked unread",
  },
  ru: {
    replies: "Ответы",
    unknownDate: "Дата неизвестна",
    loading: "Загружаем ответы…",
    empty: "Пока нет ответов.",
    up: "Ответы выше ещё не загружены.",
    down: "Ответы ниже ещё не загружены.",
    gap: "Ответы между этими ещё не загружены.",
    gapError: "Ответы между этими не загрузились",
    more: "Показать ответы",
    upError: "Ответы выше не загрузились",
    downError: "Ответы ниже не загрузились",
    unavailable: "Это обсуждение больше недоступно.",
    limited: "Обсуждение за пределами доступной истории сервера.",
    noRoot: "Исходное сообщение ещё не сохранено на устройстве.",
    viewUnconfirmed: "Не удалось подтвердить отметку",
    viewCheck: "Проверить отметку",
    viewChecking: "Проверяем отметку…",
    viewCheckedRead: "Проверили: тред не отмечен непрочитанным",
    viewCheckedUnread: "Проверили: тред отмечен непрочитанным",
  },
} as const;
type Reader = ReturnType<typeof openThreadReplyWindow>;
type Following = ReturnType<typeof openThreadFollowControl>;
type WindowState = ReturnType<Reader["getSnapshot"]>;
type Direction = "up" | "down";
type InboxWindow = {
  confirmedRoot?: LocalPost;
  opening?: boolean;
  retained?: ParkedThreadWindow;
  restoreFocus?: boolean;
  park?: (window: ParkedThreadWindow) => void;
  register?: (id: string, capture: () => void) => () => void;
};
type Props = {
  connection: WorkspaceConnection;
  userId: string;
  post: LocalPost;
  arrivalRequest?: number;
  prepared?: Reader;
  preparedRoot?: LocalPost;
  returningToLink?: boolean;
  collapsedThreads: boolean;
  teamId: string;
  controlsHost: HTMLSpanElement | null;
  confirmFollowing: (id: string, following: boolean) => void;
  locale: EntryLanguage;
  online: boolean;
  author: TimelineAuthor;
  nameFormat: NameFormat;
  sessionIssue: (issue: "session" | "unauthorized") => void;
  eventReader: RefObject<Reader | null>;
  historyAccess?: ChannelHistoryAccess;
  onOpened?: () => void;
  onUnavailable?: (reason: "forbidden" | "limited" | "failed") => void;
  renderComposer: (
    rootId: string,
    reader: Reader,
    acceptedReply?: () => void,
  ) => ReactNode;
  lastViewedAt?: number;
  confirmView?: (signal: AbortSignal) => Promise<void>;
  readVisit?: ThreadReadVisit;
  checkView?: (signal: AbortSignal, onRevoked: () => void) => Promise<void>;
  inboxWindow?: InboxWindow;
};
const noReview = () => undefined;
const noSubscription = () => () => {};

export function ThreadPane(props: Props) {
  const {
    connection,
    post,
    collapsedThreads,
    lastViewedAt,
    userId,
    teamId,
    prepared,
    confirmFollowing,
    eventReader,
    historyAccess,
  } = props;
  const retained = props.inboxWindow?.retained;
  const registerWindow = props.inboxWindow?.register;
  const park = props.inboxWindow?.park;
  const preview = props.inboxWindow ? post : undefined;
  const feed = useRef<ThreadFeed>(null);
  const composer = useRef<HTMLDivElement>(null);
  const focus = useRef<ThreadReadingPlace["focus"]>(undefined);
  const [session, setSession] = useState<{
    reader: Reader;
    following?: Following;
  } | null>(null);
  useLayoutEffect(() => {
    const rootId = post.rootId ?? post.id;
    const reader =
      prepared ??
      openThreadReplyWindow(
        connection,
        {
          channelId: post.channelId,
          rootId,
          collapsedThreads,
        },
        post.rootId
          ? post
          : lastViewedAt !== undefined
            ? { lastViewedAt, userId }
            : undefined,
        preview,
        retained?.replies,
      );
    const following = collapsedThreads
      ? openThreadFollowControl(
          connection,
          teamId,
          post.channelId,
          rootId,
          reader,
          confirmFollowing,
        )
      : undefined;
    setSession({ reader, following });
    eventReader.current = reader;
    const unregister = registerWindow?.(rootId, () => {
      if (!park || prepared) return;
      const place = feed.current?.getReadingPlace();
      const replies = place && reader.retain(place);
      if (place && replies)
        park({
          replies,
          place: {
            ...place,
            focus: focus.current,
            composerHeight: composer.current?.getBoundingClientRect().height,
          },
        });
    });
    return () => {
      if (eventReader.current === reader) eventReader.current = null;
      unregister?.();
      following?.close();
      if (!prepared) reader.close();
    };
  }, [
    connection,
    post,
    collapsedThreads,
    lastViewedAt,
    userId,
    prepared,
    teamId,
    confirmFollowing,
    eventReader,
    preview,
    retained,
    registerWindow,
    park,
  ]);
  useLayoutEffect(() => {
    if (!session || !historyAccess) return;
    const { reader } = session;
    if (historyAccess.revoked) {
      reader.unavailable("forbidden");
      return;
    }
    reader.restrictHistory(
      { kind: "cutoff", time: historyAccess.cutoff },
      post.rootId ? undefined : post.createAt,
    );
    for (const postId of historyAccess.unavailablePosts ?? [])
      reader.restrictHistory({ kind: "unavailable", postId });
  }, [session, historyAccess, post]);
  return session ? (
    <ThreadContent
      {...props}
      {...session}
      feedRef={feed}
      focusRef={focus}
      composerRef={composer}
    />
  ) : null;
}

function ThreadContent({
  reader,
  following,
  controlsHost,
  collapsedThreads,
  connection,
  userId,
  post,
  arrivalRequest,
  returningToLink,
  preparedRoot,
  online,
  locale,
  author,
  nameFormat,
  sessionIssue,
  renderComposer,
  onOpened,
  confirmView,
  readVisit,
  checkView,
  onUnavailable,
  inboxWindow,
  historyAccess,
  feedRef,
  focusRef,
  composerRef,
}: Props & {
  reader: Reader;
  following?: Following;
  feedRef: { current: ThreadFeed | null };
  focusRef: { current: ThreadReadingPlace["focus"] };
  composerRef: { current: HTMLDivElement | null };
}) {
  const [unseenReply, setUnseenReply] = useState<{
    reader: Reader;
    id: string;
  }>();
  const announcedBy = useRef<Reader>(undefined);
  const subscribe = useCallback(
    (changed: () => void) =>
      reader.subscribe(() => {
        const id = reader.getSnapshot().newReplyId;
        if (id && announcedBy.current !== reader) {
          announcedBy.current = reader;
          if (feedRef.current?.getReadingPlace()?.atEnd === false)
            setUnseenReply({ reader, id });
        }
        changed();
      }),
    [reader, feedRef],
  );
  const state = useSyncExternalStore(subscribe, reader.getSnapshot);
  const review = useSyncExternalStore(
    readVisit?.subscribeAutoReview ?? noSubscription,
    readVisit?.getAutoReview ?? noReview,
  );
  const mark = useEffectEvent((signal: AbortSignal) => confirmView?.(signal));
  const [opened, setOpened] = useState<Reader>();
  const canMark = Boolean(
    confirmView &&
      !review &&
      (!inboxWindow || opened === reader) &&
      state.root &&
      !state.unavailable &&
      (state.up.status === "ready" || state.up.status === "end") &&
      (state.down.status === "ready" || state.down.status === "end"),
  );
  const [readFailed, setReadFailed] = useState(false);
  const [checkingVisit, setCheckingVisit] = useState<ThreadReadVisit>();
  const checking = readVisit !== undefined && checkingVisit === readVisit;
  const checkRequest = useRef<{
    visit: ThreadReadVisit;
    controller: AbortController;
  } | null>(null);
  const readAction = useRef<HTMLButtonElement>(null);
  useLayoutEffect(
    () => () => {
      const pending = checkRequest.current;
      if (pending && pending.visit === readVisit) {
        pending.controller.abort();
        checkRequest.current = null;
      }
    },
    [readVisit],
  );
  function focusHeading() {
    readAction.current
      ?.closest("aside")
      ?.querySelector<HTMLElement>(".thread-heading h2")
      ?.focus({ preventScroll: true });
  }
  async function verifyView() {
    if (!checkView || !readVisit || checkRequest.current) return;
    const request = { visit: readVisit, controller: new AbortController() };
    checkRequest.current = request;
    setCheckingVisit(readVisit);
    try {
      await checkView(request.controller.signal, () => {
        if (
          readAction.current
            ?.closest(".thread-window")
            ?.contains(document.activeElement)
        )
          focusHeading();
      });
    } finally {
      if (checkRequest.current === request) {
        checkRequest.current = null;
        setCheckingVisit(undefined);
      }
    }
  }
  const retryRead = useRef<(() => void) | null>(null);
  const marked = useRef(false);
  const finishMark = useEffectEvent(() => {
    if (
      !readVisit?.getAutoReview() &&
      document.activeElement === readAction.current
    )
      focusHeading();
    setReadFailed(false);
  });
  useEffect(() => {
    if (!online || !canMark || marked.current) return;
    const lifetime = new AbortController();
    let running = false;
    async function read() {
      if (
        running ||
        lifetime.signal.aborted ||
        marked.current ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
      )
        return;
      running = true;
      try {
        await mark(lifetime.signal);
        if (!lifetime.signal.aborted) {
          marked.current = true;
          finishMark();
        }
      } catch {
        if (!lifetime.signal.aborted) setReadFailed(true);
      } finally {
        running = false;
      }
    }
    retryRead.current = read;
    void read();
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      lifetime.abort();
      retryRead.current = null;
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, [online, canMark]);
  const [savedRoot, setSavedRoot] = useState<LocalPost | null>(null);
  const [localFailure, setLocalFailure] = useState<ReturnType<
    typeof workspaceFailure
  > | null>(null);
  const text = copy[locale];
  const workspace = workspaceCopy[locale];
  const reportOpen = useEffectEvent(() => {
    const opened = reader.getSnapshot();
    if (opened.unavailable) return;
    if (opened.up.status === "error" || opened.down.status === "error")
      onUnavailable?.("failed");
    else {
      if (reader.hasReadPage()) setOpened(reader);
      onOpened?.();
    }
  });
  const confirmedRoot = inboxWindow?.confirmedRoot;
  const mayOpen = !inboxWindow || Boolean(confirmedRoot);
  useEffect(() => {
    let active = true;
    if (online && mayOpen) {
      if (confirmedRoot) reader.confirmRoot(confirmedRoot);
      void reader.open().then(() => {
        if (active) reportOpen();
      });
    }
    return () => {
      active = false;
    };
  }, [online, reader, confirmedRoot, mayOpen]);
  const candidate = state.root ?? (post.rootId ? savedRoot : post);
  const historyCutoff = Math.max(
    historyAccess?.cutoff ?? 0,
    state.firstInaccessiblePostTime ?? 0,
  );
  const inaccessible =
    state.unavailable ??
    (candidate && candidate.createAt <= historyCutoff
      ? "limited"
      : undefined) ??
    (localFailure === "session" ||
    localFailure === "unauthorized" ||
    localFailure === "forbidden"
      ? localFailure
      : undefined);
  useEffect(() => {
    if (inaccessible === "session" || inaccessible === "unauthorized")
      sessionIssue(inaccessible);
    if (inaccessible === "limited" || inaccessible === "forbidden")
      onUnavailable?.(inaccessible);
  }, [sessionIssue, inaccessible, onUnavailable]);
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
  const contentRef = useRef<HTMLDivElement>(null);
  const wantedFocus = inboxWindow?.restoreFocus
    ? inboxWindow.retained?.place.focus
    : undefined;
  useLayoutEffect(() => {
    const field = contentRef.current;
    if (!field || !wantedFocus) return;
    const target =
      wantedFocus.kind === "reply"
        ? field.querySelector<HTMLElement>(
            `[data-post-id="${CSS.escape(wantedFocus.id)}"]`,
          )
        : field.querySelector<HTMLElement>(
            wantedFocus.kind === "editor" ? "textarea" : ".thread-feed",
          );
    target?.focus({ preventScroll: true });
  }, [wantedFocus]);
  const observed = review?.mark;
  const position =
    observed?.unreadReplies === 0
      ? null
      : reader.getUnreadPosition(
          observed && { lastViewedAt: observed.lastViewedAt, userId },
        );
  const firstUnread =
    position?.kind === "found"
      ? position.postId
      : !observed && unseenReply?.reader === reader
        ? unseenReply.id
        : undefined;
  const outgoing = useConversationOutgoing({
    connection,
    userId,
    channelId: post.channelId,
    rootId: post.rootId ?? post.id,
    history,
    placement: state.down.status === "end" ? "timeline" : "afterGap",
    locale,
    enabled: canReply,
    accepted: following?.acceptedReply,
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
    return (
      author(id) ??
      (person && {
        name: teammateName(person, nameFormat),
        isBot: person.isBot,
      })
    );
  }
  const time = useTimelinePostFormat(locale);
  if (inaccessible)
    return (
      <p className="timeline-empty" role="alert">
        {inaccessible === "limited" ? text.limited : text.unavailable}
      </p>
    );
  const summary =
    collapsedThreads &&
    (root?.threadSummary ??
      (post.rootId ? (savedRoot ?? preparedRoot) : post)?.threadSummary);
  const waitingForReplies =
    inboxWindow &&
    !inboxWindow.retained &&
    state.replies.length === 0 &&
    (inboxWindow.opening ||
      state.up.status === "loading" ||
      state.down.status === "loading");
  function renderReply(row: TimelineMessage, continuation: boolean) {
    return (
      <div key={row.localId ?? row.id} className="thread-reply">
        {row.id === firstUnread && (
          <div className="thread-unread-marker">
            <hr
              className="inbox-sr"
              aria-label={threadInboxCopy[locale].marker}
            />
            <span aria-hidden="true">{threadInboxCopy[locale].marker}</span>
          </div>
        )}
        <TimelinePost
          post={row}
          continuation={continuation}
          addressed={row.id === post.id}
          focusable
          inThread
          locale={locale}
          time={time.clock}
          menuDate={time}
          author={resolve}
          ownName={outgoing.ownName}
        >
          {row.outgoing && outgoing.renderOutgoing(row.outgoing)}
        </TimelinePost>
      </div>
    );
  }
  return (
    <div
      className="thread-window"
      ref={contentRef}
      onFocusCapture={
        inboxWindow
          ? ({ target }) => {
              if (!(target instanceof HTMLElement)) return;
              const id = target.closest<HTMLElement>(
                ".thread-reply [data-post-id]",
              )?.dataset.postId;
              if (id) focusRef.current = { kind: "reply", id };
              else if (target instanceof HTMLTextAreaElement)
                focusRef.current = { kind: "editor" };
              else if (target.matches(".thread-feed"))
                focusRef.current = { kind: "feed" };
            }
          : undefined
      }
    >
      <ThreadFeed
        ref={feedRef}
        focusedId={post.rootId && !returningToLink ? post.id : undefined}
        arrivalRequest={arrivalRequest}
        firstUnread={firstUnread}
        retainedPlace={inboxWindow?.retained?.place}
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
              inThread
              locale={locale}
              time={time.clock}
              menuDate={time}
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
        {waitingForReplies && (
          <p
            className="thread-window-loading panel-text--secondary"
            role="status"
          >
            {text.loading}
          </p>
        )}
        {!waitingForReplies && (
          <ThreadEdge
            reader={reader}
            direction="up"
            edge={state.up}
            online={online}
            locale={locale}
          />
        )}
        {outgoing.localNotice}
        <TimelineDays
          messages={[...outgoing.messages, ...outgoing.afterGap]}
          locale={locale}
          author={resolve}
          unknownDate={text.unknownDate}
          boundary={
            !waitingForReplies
              ? {
                  index: outgoing.messages.length,
                  node: (
                    <ThreadEdge
                      key="reply-window-boundary"
                      reader={reader}
                      direction="down"
                      edge={state.down}
                      online={online}
                      locale={locale}
                      gap={outgoing.afterGap.length > 0}
                    />
                  ),
                }
              : undefined
          }
        >
          {renderReply}
        </TimelineDays>
        {state.root &&
          state.up.status === "end" &&
          state.down.status === "end" &&
          !outgoing.messages.length && (
            <p className="timeline-empty">{text.empty}</p>
          )}
      </ThreadFeed>
      {(readFailed || review) && (
        <div className="thread-view-status">
          <span role={review ? "status" : "alert"}>
            {review
              ? checking
                ? text.viewChecking
                : review.kind === "unconfirmed"
                  ? text.viewUnconfirmed
                  : review.mark.unreadReplies > 0
                    ? text.viewCheckedUnread
                    : text.viewCheckedRead
              : threadInboxCopy[locale].readError}
          </span>
          <button
            aria-busy={checking}
            aria-disabled={checking}
            ref={readAction}
            type="button"
            onClick={() => {
              if (review) void verifyView();
              else retryRead.current?.();
            }}
          >
            {review ? text.viewCheck : workspace.retry}
          </button>
        </div>
      )}
      {canReply && mayOpen && following && controlsHost && (
        <ThreadFollowButton
          control={following}
          host={controlsHost}
          locale={locale}
          online={online}
        />
      )}
      {canReply &&
        (inboxWindow ? (
          <div
            className="thread-composer-frame"
            ref={composerRef}
            style={
              inboxWindow.retained?.place.composerHeight
                ? ({
                    "--retained-composer-height": `${inboxWindow.retained.place.composerHeight}px`,
                  } as CSSProperties)
                : undefined
            }
          >
            {renderComposer(root.id, reader, following?.acceptedReply)}
          </div>
        ) : (
          renderComposer(root.id, reader, following?.acceptedReply)
        ))}
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
        ? historyPageError(
            locale,
            gap
              ? text.gapError
              : direction === "up"
                ? text.upError
                : text.downError,
            edge.reason,
          )
        : gap
          ? text.gap
          : text[direction];
  return (
    <HistoryPageEdge
      marker={marker}
      direction={direction}
      locale={locale}
      description={description}
      loading={edge.status === "loading"}
      failed={failed}
      action={
        failed || (online && gap && edge.status === "ready")
          ? {
              label: text.more,
              run: () => {
                if (failed) void reader.retry(direction);
                else void reader.more(direction);
              },
            }
          : undefined
      }
    />
  );
}

type FeedProps = {
  state: WindowState;
  focusedId?: string;
  arrivalRequest?: number;
  firstUnread?: string;
  retainedPlace?: ThreadReadingPlace;
  label: string;
  children: ReactNode;
};
type Place = ThreadReadingPlace & { edge?: Direction };

class ThreadFeed extends Component<FeedProps> {
  private readonly frame = createRef<HTMLDivElement>();
  private readonly postTouch = createTimelinePostTouch();
  private resize?: ResizeObserver;
  private readonly pane = createRef<HTMLElement>();
  private clearArrival?: () => void;
  private lastArrival?: number;
  private lastCorrection?: TimelineScrollCorrection;

  private positionOpeningReply = true;
  private placedUnread = false;
  private userMoved = false;
  private markUserScroll = () => {
    this.positionOpeningReply = false;
    this.userMoved = true;
  };

  componentDidMount() {
    const frame = this.frame.current;
    const pane = this.pane.current;
    if (frame && pane) {
      const fit = ({ width, height }: DOMRectReadOnly) => {
        if (!width || !height) return;
        const inline = `${width}px`;
        const block = `${height}px`;
        if (pane.style.width === inline && pane.style.height === block) return;
        // Measure against the previous line wrapping before sizing the feed.
        const place = this.getSnapshotBeforeUpdate();
        pane.style.width = inline;
        pane.style.height = block;
        if (place) this.restorePlace(pane, place);
      };
      fit(frame.getBoundingClientRect());
      this.resize = new ResizeObserver(([entry]) => {
        if (entry) fit(entry.contentRect);
      });
      this.resize.observe(frame);
    }
    if (pane && this.props.retainedPlace) {
      this.positionOpeningReply = false;
      this.restorePlace(pane, this.props.retainedPlace);
    } else {
      this.centerOpeningReply(true);
      this.placeUnread();
    }
  }

  private placeUnread() {
    const pane = this.pane.current;
    if (
      !pane ||
      !this.positionOpeningReply ||
      this.placedUnread ||
      !this.props.firstUnread ||
      this.props.focusedId
    )
      return;
    const marker = pane.querySelector<HTMLElement>(".thread-unread-marker");
    if (!marker) return;
    pane.scrollTop +=
      marker.getBoundingClientRect().top -
      pane.getBoundingClientRect().top -
      Math.min(64, pane.clientHeight / 5);
    this.placedUnread = true;
  }

  componentWillUnmount() {
    this.resize?.disconnect();
    this.clearArrival?.();
  }

  private centerOpeningReply(focus: boolean) {
    const pane = this.pane.current;
    if (!pane || !this.props.focusedId) return;
    const row = pane.querySelector<HTMLElement>(
      `[data-post-id="${this.props.focusedId}"]`,
    );
    if (row && (focus || document.activeElement === row)) {
      if (focus) {
        this.clearArrival?.();
        row.focus({ preventScroll: true });
      }
      const bounds = row.getBoundingClientRect();
      pane.scrollTop +=
        bounds.top -
        pane.getBoundingClientRect().top -
        (pane.clientHeight - bounds.height) / 2;
      if (focus) {
        this.lastArrival = this.props.arrivalRequest;
        this.clearArrival = showPostArrival(row);
      }
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
      atEnd: pane.scrollHeight - pane.clientHeight - pane.scrollTop < 8,
      edge: edge === "up" || edge === "down" ? edge : undefined,
    };
    if (
      pane.scrollTop === 0 &&
      !this.props.retainedPlace &&
      !this.props.focusedId &&
      !edge
    )
      return place;
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
  getReadingPlace(): ThreadReadingPlace | null {
    const place = this.getSnapshotBeforeUpdate();
    if (!place) return null;
    const { edge: _edge, ...reading } = place;
    return { ...reading, atEnd: this.followsEnd(place) };
  }
  private followsEnd(place: Place) {
    return (
      place.atEnd ||
      (!this.userMoved && this.props.retainedPlace?.atEnd === true)
    );
  }
  private restorePlace(pane: HTMLElement, place: Place) {
    const row =
      place.id &&
      pane.querySelector<HTMLElement>(
        `[data-post-id="${CSS.escape(place.id)}"],[data-local-id="${CSS.escape(place.id)}"]`,
      );
    if (row) {
      this.lastCorrection = restoreTimelineAnchor(
        pane,
        row,
        { top: place.top, offset: place.offset ?? 0 },
        this.lastCorrection,
      );
    } else {
      this.lastCorrection = undefined;
      pane.scrollTop = place.top;
    }
  }

  componentDidUpdate(
    previous: FeedProps,
    _state: unknown,
    place: Place | null,
  ) {
    const pane = this.pane.current;
    if (!pane || !place) return;
    const { state } = this.props;
    if (
      state.newReplyId &&
      state.newReplyId !== previous.state.newReplyId &&
      this.followsEnd(place)
    ) {
      this.lastCorrection = undefined;
      pane.scrollTop = pane.scrollHeight;
    } else this.restorePlace(pane, place);
    if (
      this.props.arrivalRequest !== undefined &&
      this.lastArrival !== this.props.arrivalRequest
    ) {
      this.positionOpeningReply = true;
      this.centerOpeningReply(true);
    }
    this.placeUnread();
    if (
      this.positionOpeningReply &&
      (previous.state.up.status === "loading" ||
        previous.state.down.status === "loading")
    ) {
      this.centerOpeningReply(false);
      if (
        this.props.focusedId &&
        state.up.status !== "loading" &&
        state.down.status !== "loading"
      )
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
      <div className="timeline-frame" ref={this.frame}>
        <section
          ref={this.pane}
          onPointerDown={this.markUserScroll}
          onWheel={this.markUserScroll}
          onKeyDown={this.markUserScroll}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users can page through this independently scrollable thread.
          tabIndex={0}
          className="timeline-scroll thread-feed"
          {...this.postTouch}
          aria-label={this.props.label}
        >
          {this.props.children}
        </section>
      </div>
    );
  }
}
