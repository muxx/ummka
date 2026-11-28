import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { CollectionHeader } from "./CollectionHeader.tsx";
import {
  CollectionReadNotice,
  useCollectionRefreshVisibility,
} from "./CollectionReadNotice.tsx";
import {
  type CollectionReadingPlace,
  CollectionScroll,
  collectionReadingPlace,
  restoreCollectionReadingPlace,
  restoreCollectionRow,
} from "./CollectionScroll.tsx";
import { collectionCopy } from "./collection-copy.ts";
import { PanelState } from "./PanelState.tsx";
import { attachmentExcerpt } from "./post-attachment-cards.ts";
import {
  newestCollectionItems,
  type openPostCollection,
  returnedPostRemoved,
} from "./post-collection.ts";
import { publishedPostSummary } from "./published-post-summary.ts";
import "./post-collection-pane.css";

type Model = ReturnType<typeof openPostCollection>;
type Snapshot = ReturnType<Model["getSnapshot"]>;

function CollectionExcerpt({
  post,
  language,
  emptyLabel,
}: {
  post: NonNullable<Snapshot["value"]>["items"][number];
  language: EntryLanguage;
  emptyLabel: string;
}) {
  const body = useMemo(() => {
    const summary = publishedPostSummary(post);
    if (summary !== undefined) return summary;
    return post.attachments?.files?.some((file) => file.name?.trim())
      ? attachmentExcerpt(post.attachments, language)
      : "";
  }, [post, language]);
  return <span className="collection-excerpt">{body || emptyLabel}</span>;
}

export function CollectionMark({
  kind,
  filled = false,
}: {
  kind: "all" | "pins";
  filled?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d={
          kind === "all"
            ? "M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4z"
            : "m14 3 7 7-2 1-2 4-1 2-4-4-7 7 7-7-4-4 2-1 4-2z"
        }
      />
    </svg>
  );
}

export function PostCollectionPane({
  compact,
  model,
  state,
  kind,
  roomTitle,
  language,
  online,
  canRemove,
  channelInfo,
  authorName,
  savedIds,
  restore,
  pinnedReading,
  openRow,
  close,
}: {
  compact: boolean;
  model: Model;
  state: Snapshot;
  kind: "all" | "pins";
  roomTitle?: string;
  language: EntryLanguage;
  online: boolean;
  canRemove: boolean;
  channelInfo: (
    id: string,
  ) => { title: string; kind: string; team?: string } | undefined;
  authorName: (id: string) => string | undefined;
  savedIds: ReadonlySet<string>;
  restore: {
    id: string;
    scroll: number;
    offset?: number;
    index?: number;
  } | null;
  pinnedReading?: {
    place?: CollectionReadingPlace;
    remember: (place: CollectionReadingPlace) => void;
  };
  openRow: (
    id: string,
    trigger: HTMLButtonElement,
    scroll: number,
    offset?: number,
  ) => void;
  close: () => void;
}) {
  const text = collectionCopy[language];
  const headingId = useId();
  const captionId = `${headingId}-caption`;
  const caption =
    kind === "all"
      ? text.personal
      : state.status === "forbidden"
        ? undefined
        : roomTitle
          ? text.sharedIn(roomTitle)
          : text.shared;
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLElement>(null);
  const removeFocus = useRef<{
    ids: string[];
    button: HTMLButtonElement;
  } | null>(null);
  const [failed, setFailed] = useState<
    ReadonlyMap<string, "refused" | "network" | "storage">
  >(() => new Map());
  const edge = useRef<HTMLDivElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const retryRows = useRef<Set<string> | null>(null);
  const initial = useRef(restore);
  const openingPlace = useRef(pinnedReading?.place);
  const returnedStatus = useRef<HTMLParagraphElement>(null);
  const returnedEmpty = useRef<HTMLHeadingElement>(null);
  const [missingReturn, setMissingReturn] = useState<{
    id: string | undefined;
    scroll: number;
    focus: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    if (kind !== "all" || !online) return;
    model.setVisible(true);
    return () => model.setVisible(false);
  }, [kind, model, online]);
  useLayoutEffect(() => {
    if (restoreCollectionRow(list.current, initial.current))
      initial.current = null;
    else if (!restoreCollectionReadingPlace(list.current, openingPlace.current))
      heading.current?.focus();
  }, []);
  useLayoutEffect(() => {
    const pane = list.current;
    if (pane && pinnedReading)
      return () => pinnedReading.remember(collectionReadingPlace(pane));
  }, [pinnedReading]);
  const rows = useMemo(
    () => newestCollectionItems(state.value?.items ?? []),
    [state.value],
  );
  useLayoutEffect(() => {
    const place = initial.current;
    if (!place) return;
    const focused = document.activeElement;
    const focus =
      focused === heading.current ||
      (retryRows.current !== null &&
        (focused === document.body ||
          Boolean(edge.current?.contains(focused))));
    if (rows.some((row) => row.id === place.id)) {
      if (focus) {
        retryRows.current = null;
        restoreCollectionRow(list.current, place);
      }
      initial.current = null;
    } else if (
      place.index !== undefined &&
      returnedPostRemoved(state, place.id, place.index)
    ) {
      if (focus) retryRows.current = null;
      initial.current = null;
      setMissingReturn({
        id: rows[Math.min(place.index, rows.length - 1)]?.id,
        scroll: place.scroll,
        focus,
      });
    }
  }, [rows, state]);
  useLayoutEffect(() => {
    if (!missingReturn?.focus) return;
    const { id, scroll } = missingReturn;
    if (id)
      restoreCollectionRow(
        list.current,
        { id, scroll },
        returnedStatus.current,
      );
    else returnedEmpty.current?.focus({ preventScroll: true });
  }, [missingReturn]);
  useLayoutEffect(() => {
    if (state.status !== "ready" || state.removing.length)
      setMissingReturn(null);
  }, [state.status, state.removing.length]);
  function refresh() {
    const place = initial.current;
    void model.refresh(place?.index === undefined ? undefined : place.id);
  }
  const dates = useMemo(
    () => ({
      short: new Intl.DateTimeFormat(language, {
        month: "long",
        day: "numeric",
      }),
      full: new Intl.DateTimeFormat(language, {
        dateStyle: "full",
        timeStyle: "short",
      }),
    }),
    [language],
  );
  useLayoutEffect(() => {
    if (!removeFocus.current) return;
    const {
      ids: [removed, ...candidates],
      button: source,
    } = removeFocus.current;
    if (rows.some((row) => row.id === removed)) return;
    removeFocus.current = null;
    if (
      document.activeElement !== document.body &&
      document.activeElement !== source
    )
      return;
    for (const id of candidates) {
      const button = list.current?.querySelector<HTMLButtonElement>(
        `[data-collection-remove="${CSS.escape(id)}"]`,
      );
      if (button && !button.disabled) {
        button.focus();
        return;
      }
    }
    heading.current?.focus();
  }, [rows]);
  const previousRead = useRef(state);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const before = previousRead.current;
    previousRead.current = state;
    if (!state.value || state.status !== "ready") {
      setAnnouncement("");
      return;
    }
    const n = state.value.items.length;
    if (!before.value && n)
      setAnnouncement(
        state.continuation === "none" ? text.count(n) : text.loaded(n),
      );
    else if (
      before.continuation === "loading" &&
      state.continuation !== "loading"
    ) {
      if (state.continuation === "none") setAnnouncement(text.finished);
      else if (
        state.continuation === "available" &&
        n > (before.value?.items.length ?? 0)
      )
        setAnnouncement(text.earlierLoaded);
    }
  }, [state, text]);
  const canRead =
    online &&
    !["closed", "unauthorized", "session", "forbidden"].includes(state.status);
  const showRefresh = useCollectionRefreshVisibility(
    state.status === "refreshing",
  );
  const busy = state.status === "loading" || state.status === "refreshing";
  const nextFailed =
    state.continuation === "network" || state.continuation === "storage";
  useEffect(() => {
    const boundary = edge.current;
    if (!boundary || !canRead || busy || state.continuation !== "available")
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio > 0,
          )
        )
          void model.loadMore();
      },
      { root: list.current },
    );
    observer.observe(boundary);
    return () => observer.disconnect();
  }, [model, canRead, busy, state.continuation]);
  useLayoutEffect(() => {
    const previous = retryRows.current;
    if (!previous || state.continuation === "loading") return;
    const focused = document.activeElement;
    if (focused === document.body || edge.current?.contains(focused)) {
      if (nextFailed) retry.current?.focus({ preventScroll: true });
      else {
        const fresh = rows.find((row) => !previous.has(row.id));
        if (!fresh && state.continuation === "available") return;
        const target =
          fresh &&
          list.current?.querySelector<HTMLElement>(
            `[data-collection-post="${CSS.escape(fresh.id)}"]`,
          );
        (target || heading.current)?.focus({ preventScroll: true });
      }
    }
    retryRows.current = null;
  }, [nextFailed, rows, state.continuation]);
  return (
    <aside className="post-collection-pane" aria-labelledby={headingId}>
      <CollectionHeader
        compact={compact}
        icon={<CollectionMark kind={kind} />}
        caption={
          caption && (
            <span id={captionId} title={roomTitle ? caption : undefined}>
              {caption}
            </span>
          )
        }
        closeLabel={text.close}
        close={close}
      >
        <h2
          tabIndex={-1}
          id={headingId}
          aria-describedby={caption ? captionId : undefined}
          ref={heading}
        >
          {kind === "all" ? text.saved : text.pins}
        </h2>
      </CollectionHeader>
      <span className="collection-announcement" role="status">
        {announcement}
      </span>
      <CollectionScroll
        pane={list}
        label={collectionCopy[language].content}
        pins={kind === "pins"}
      >
        <CollectionReadNotice
          kind={kind}
          status={state.status}
          showRefresh={showRefresh}
          hasResponse={state.value !== null}
          online={online}
          language={language}
          list={list}
          heading={heading}
          refresh={refresh}
        />
        {state.removing.length > 0 && (
          <p role="status">{kind === "all" ? text.removing : text.unpinning}</p>
        )}
        {restore?.index !== undefined && (
          <p
            className="collection-return-status"
            ref={returnedStatus}
            role="status"
          >
            {missingReturn?.id && text.removedOnReturn}
          </p>
        )}
        {!online && state.value && state.status !== "network" && (
          <PanelState variant="stale" role="status" message={text.offline} />
        )}
        {state.status === "forbidden" && <p role="alert">{text.unavailable}</p>}
        {state.value && (
          <ul>
            {rows.map((row, index) => {
              const showRemoval = canRemove && canRead;
              const name = row.userId && authorName(row.userId);
              const room = channelInfo(row.channelId);
              let place = "";
              if (kind === "all") {
                if (!room) place = text.conversation;
                else if (room.kind === "D" || room.kind === "G") {
                  const context = room.kind === "D" ? text.direct : text.group;
                  place = room.title ? room.title + " · " + context : context;
                } else {
                  place = `# ${room.title}`;
                  if (room.team) place += ` · ${text.otherTeam(room.team)}`;
                }
              }
              if (row.rootId)
                place = place
                  ? place + " · " + text.reply.toLocaleLowerCase(language)
                  : text.reply;
              const mark =
                kind === "all"
                  ? row.isPinned && "pins"
                  : savedIds.has(row.id) && "all";
              const stamp =
                row.createAt &&
                Number.isFinite(new Date(row.createAt).getTime())
                  ? new Date(row.createAt)
                  : null;
              return (
                <li
                  key={row.id}
                  className={
                    kind === "all" ? "collection-saved-row" : undefined
                  }
                >
                  <button
                    type="button"
                    className="collection-open"
                    data-collection-post={row.id}
                    aria-current={restore?.id === row.id || undefined}
                    aria-disabled={!canRead}
                    onClick={(event) => {
                      if (!canRead) return;
                      const pane = list.current;
                      openRow(
                        row.id,
                        event.currentTarget,
                        pane?.scrollTop ?? 0,
                        pane
                          ? event.currentTarget.getBoundingClientRect().top -
                              pane.getBoundingClientRect().top
                          : undefined,
                      );
                    }}
                  >
                    <span className="collection-avatar" aria-hidden="true">
                      {name ? Array.from(name)[0] : null}
                    </span>
                    <span className="collection-content">
                      <strong className="collection-author">
                        {name || text.member}
                      </strong>
                      {place && (
                        <span className="collection-meta">{place}</span>
                      )}
                      <CollectionExcerpt
                        post={row}
                        language={language}
                        emptyLabel={
                          row.fileIds?.length ? text.attachment : text.message
                        }
                      />
                      {mark && (
                        <span className="collection-badges">
                          <CollectionMark kind={mark} />
                          {mark === "pins" ? text.pinnedLabel : text.savedLabel}
                        </span>
                      )}
                    </span>
                    {stamp && (
                      <time
                        className="collection-date"
                        dateTime={stamp.toISOString()}
                        title={dates.full.format(stamp)}
                      >
                        {dates.short.format(stamp)}
                      </time>
                    )}
                  </button>
                  {showRemoval && (
                    <button
                      type="button"
                      className="collection-remove channels-icon-action"
                      data-collection-remove={row.id}
                      aria-label={kind === "all" ? text.unsave : text.unpin}
                      title={kind === "all" ? text.unsave : text.unpin}
                      aria-disabled={state.removing.includes(row.id)}
                      onClick={(event) => {
                        if (state.removing.includes(row.id)) return;
                        const control = event.currentTarget;
                        removeFocus.current = {
                          button: control,
                          ids: [
                            row.id,
                            ...rows.slice(index + 1).map((item) => item.id),
                            ...rows
                              .slice(0, index)
                              .reverse()
                              .map((item) => item.id),
                          ],
                        };
                        if (failed.has(row.id))
                          setFailed((previous) => {
                            const next = new Map(previous);
                            next.delete(row.id);
                            return next;
                          });
                        void model.remove(row.id).then((outcome) => {
                          if (
                            !control.isConnected ||
                            model.getSnapshot().status === "closed"
                          )
                            return;
                          if (
                            outcome === "refused" ||
                            outcome === "network" ||
                            outcome === "storage"
                          ) {
                            if (removeFocus.current?.button === control)
                              removeFocus.current = null;
                            setFailed((previous) =>
                              new Map(previous).set(row.id, outcome),
                            );
                          }
                        });
                      }}
                    >
                      <CollectionMark kind={kind} />
                    </button>
                  )}
                  {failed.has(row.id) && (
                    <p role="alert">
                      {failed.get(row.id) === "network"
                        ? text.changeNetwork
                        : failed.get(row.id) === "storage"
                          ? text.changeStorage
                          : text.refused}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {(state.status === "ready" || (kind === "pins" && state.value)) &&
          !rows.length &&
          state.continuation === "none" &&
          (missingReturn && !missingReturn.id ? (
            <PanelState
              variant="empty"
              title={text.emptyReturnedSaved}
              titleRef={returnedEmpty}
            />
          ) : (
            <PanelState
              variant="empty"
              title={kind === "all" ? text.emptySaved : text.emptyPins}
              titleRef={kind === "pins" ? returnedEmpty : undefined}
            />
          ))}
        {Boolean(state.value?.firstInaccessiblePostTime) && (
          <p role="status">{text.unavailableHistory}</p>
        )}
        {state.value && state.continuation !== "none" && (
          <div className="collection-edge" ref={edge} tabIndex={-1}>
            <span role={nextFailed ? "alert" : "status"}>
              {nextFailed
                ? text.edgeFailed
                : state.continuation === "loading"
                  ? text.next
                  : text.more}
            </span>
            {nextFailed && canRead && !busy && (
              <button
                type="button"
                className="collection-page-action"
                ref={retry}
                aria-label={text.retryEarlier}
                onClick={() => {
                  retryRows.current = new Set(rows.map((row) => row.id));
                  edge.current?.focus({ preventScroll: true });
                  void model.loadMore();
                }}
              >
                {text.retry}
              </button>
            )}
          </div>
        )}
      </CollectionScroll>
    </aside>
  );
}
