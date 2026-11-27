import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { CollectionReadNotice } from "./CollectionReadNotice.tsx";
import { CollectionScroll, restoreCollectionRow } from "./CollectionScroll.tsx";
import { collectionCopy } from "./collection-copy.ts";
import {
  newestCollectionItems,
  type openPostCollection,
} from "./post-collection.ts";
import { initials } from "./profile-initials.ts";
import { publishedPostDocument } from "./published-post-document.ts";
import { publishedPostExcerpt } from "./published-post-excerpt.ts";
import "./post-collection-pane.css";

type Model = ReturnType<typeof openPostCollection>;
type Snapshot = ReturnType<Model["getSnapshot"]>;

function CollectionExcerpt({
  message,
  emptyLabel,
}: {
  message: string;
  emptyLabel: string;
}) {
  const body = useMemo(
    () => publishedPostExcerpt(publishedPostDocument({ message })),
    [message],
  );
  return <span className="collection-excerpt">{body || emptyLabel}</span>;
}

export function CollectionMark({ kind }: { kind: "all" | "pins" }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
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
  model,
  state,
  kind,
  language,
  online,
  canRemove,
  channelInfo,
  authorName,
  savedIds,
  restore,
  openRow,
  close,
}: {
  model: Model;
  state: Snapshot;
  kind: "all" | "pins";
  language: EntryLanguage;
  online: boolean;
  canRemove: boolean;
  channelInfo: (id: string) => { title: string; kind: string } | undefined;
  authorName: (id: string) => string | undefined;
  savedIds: ReadonlySet<string>;
  restore: { id: string; scroll: number } | null;
  openRow: (id: string, trigger: HTMLButtonElement, scroll: number) => void;
  close: () => void;
}) {
  const text = collectionCopy[language];
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
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
  useLayoutEffect(() => {
    if (!restoreCollectionRow(list.current, initial.current))
      heading.current?.focus();
  }, []);
  const rows = useMemo(
    () => newestCollectionItems(state.value?.items ?? []),
    [state.value],
  );
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
  const busy = state.status === "loading" || state.status === "refreshing";
  const retryList = state.status === "network" || state.status === "storage";
  const coldOffline = !online && !state.value && state.status === "idle";
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
      <header className="channels-pane-head">
        <CollectionMark kind={kind} />
        <div className="collection-heading">
          <h2 tabIndex={-1} id={headingId} ref={heading}>
            {kind === "all" ? text.saved : text.pins}
          </h2>
          <span>{kind === "all" ? text.personal : text.shared}</span>
        </div>
        {canRead && state.value && (
          <button
            type="button"
            className="channels-icon-action"
            aria-label={text.refresh}
            title={text.refresh}
            disabled={busy}
            onClick={() => void model.refresh()}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.7"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 5v5h-5M20 10a8 8 0 1 0 0 5" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="channels-icon-action collection-close"
          aria-label={text.close}
          title={text.close}
          onClick={close}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.7"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path
              className="collection-desktop-close"
              d="m6 6 12 12M18 6 6 18"
            />
            <path className="collection-mobile-close" d="m14 5-7 7 7 7" />
          </svg>
        </button>
      </header>
      <span className="collection-announcement" role="status">
        {announcement}
      </span>
      <CollectionScroll pane={list}>
        {kind === "all" && (
          <CollectionReadNotice
            kind="all"
            status={state.status}
            hasResponse={state.value !== null}
            online={online}
            language={language}
            list={list}
            heading={heading}
            refresh={() => void model.refresh()}
          />
        )}
        {state.removing.length > 0 && (
          <p role="status">{kind === "all" ? text.removing : text.unpinning}</p>
        )}
        {!online && (kind === "pins" || state.value) && (
          <p role="status">{state.value ? text.offline : text.offlineCold}</p>
        )}
        {kind === "pins" && busy && (
          <p role="status">
            {state.status === "refreshing" ? text.refreshing : text.loading}
          </p>
        )}
        {state.status === "forbidden" && <p role="alert">{text.unavailable}</p>}
        {kind === "pins" && retryList && (
          <p role="alert">
            {state.status === "storage" ? text.storage : text.network}
          </p>
        )}
        {kind === "pins" && (retryList || coldOffline) && (
          <button
            className="collection-page-action"
            type="button"
            onClick={() => {
              heading.current?.focus({ preventScroll: true });
              void model.refresh();
            }}
          >
            {text.retry}
          </button>
        )}
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
                } else place = "# " + room.title;
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
                <li key={row.id}>
                  <button
                    type="button"
                    className="collection-open"
                    data-collection-post={row.id}
                    aria-current={restore?.id === row.id || undefined}
                    aria-disabled={!canRead}
                    onClick={(event) => {
                      if (!canRead) return;
                      openRow(
                        row.id,
                        event.currentTarget,
                        list.current?.scrollTop ?? 0,
                      );
                    }}
                  >
                    <span className="timeline-avatar" aria-hidden="true">
                      {name ? initials(name) : "•"}
                    </span>
                    <span className="collection-content">
                      <strong className="collection-author">
                        {name || text.member}
                      </strong>
                      {place && (
                        <span className="collection-meta">{place}</span>
                      )}
                      <CollectionExcerpt
                        message={row.message ?? ""}
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
        {state.status === "ready" &&
          !rows.length &&
          state.continuation === "none" && (
            <p>{kind === "all" ? text.emptySaved : text.emptyPins}</p>
          )}
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
