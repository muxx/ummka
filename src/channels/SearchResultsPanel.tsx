import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { ResponseError } from "../../vendor/mattermost/index.js";
import type { EntryLanguage } from "../entry/language.ts";
import { searchCopy } from "./search-copy.ts";
import type { openSearchResults } from "./search-results-session.ts";

export type SearchSession = ReturnType<typeof openSearchResults>;
export type SearchKind = "posts" | "files";

export function SearchResultsPanel({
  session,
  terms,
  filesAllowed,
  online,
  language,
  edit,
  dismiss,
  channelName,
  authorName,
  sessionIssue,
  activate,
  restore,
}: {
  session: SearchSession;
  terms: string;
  filesAllowed: boolean;
  online: boolean;
  language: EntryLanguage;
  edit: () => void;
  dismiss: () => void;
  channelName: (id: string) => string | undefined;
  authorName: (id: string) => string | undefined;
  sessionIssue: (issue: "unauthorized") => void;
  activate: (
    source: { kind: "post" | "file"; id: string },
    button: HTMLButtonElement,
    scroll: number,
  ) => void;
  restore: { id: string; scroll: number } | null;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const selected = state.selected;
  const tab = state[selected];
  const text = searchCopy[language];
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const opening = useRef(restore);
  const status =
    tab.error instanceof ResponseError ? tab.error.response.status : null;
  const denied = status === 401 || status === 403 || status === 404;
  useEffect(() => {
    const destination = opening.current;
    const row =
      destination &&
      list.current?.querySelector<HTMLButtonElement>(
        `[data-search-result="${CSS.escape(destination.id)}"]`,
      );
    if (list.current && destination && row) {
      list.current.scrollTop = destination.scroll;
      row.focus({ preventScroll: true });
    } else heading.current?.focus();
  }, []);
  useEffect(() => {
    if (status === 401) sessionIssue("unauthorized");
  }, [status, sessionIssue]);
  const rows =
    selected === "posts"
      ? state.posts.items.map((row) => ({
          id: row.id,
          jump: true,
          title: row.message || text.attachment,
          name: row.userId && authorName(row.userId),
          channel: channelName(row.channelId),
        }))
      : state.files.items.map((row) => ({
          id: row.id,
          jump: Boolean(row.postId),
          title: row.name || text.unnamed,
          name: row.userId && authorName(row.userId),
          channel: channelName(row.channelId),
        }));
  return (
    <aside className="search-results-pane" aria-labelledby={id}>
      <header className="channels-pane-head">
        <h2 id={id} ref={heading} tabIndex={-1}>
          {text.results}
        </h2>
        <button
          className="channels-icon-action"
          type="button"
          onClick={dismiss}
          aria-label={text.close}
        >
          ×
        </button>
      </header>
      <button
        type="button"
        className="search-query-summary"
        aria-label={text.edit + ", " + terms}
        onClick={edit}
      >
        {terms}
      </button>
      {filesAllowed && (
        <fieldset className="search-kind-switch" aria-label={text.results}>
          {(["posts", "files"] as const).map((kind) => (
            <button
              type="button"
              key={kind}
              aria-pressed={selected === kind}
              disabled={!online && state[kind].status === "idle"}
              onClick={() => void session.select(kind)}
            >
              {text[kind]}
              {state[kind].items.length > 0 && " · " + state[kind].items.length}
            </button>
          ))}
        </fieldset>
      )}
      <div
        ref={list}
        className="channels-pane-body search-result-list"
        aria-busy={tab.status === "loading"}
      >
        {!online && <p role="status">{text.offline}</p>}
        {tab.retentionTime > 0 && <p>{text.retention}</p>}
        {!denied && rows.length > 0 && (
          <ul>
            {rows.map((row) => (
              <li key={row.id}>
                {(row.channel || row.name) && (
                  <small>
                    {[row.channel, row.name].filter(Boolean).join(" · ")}
                  </small>
                )}
                {selected === "files" && <p>{row.title}</p>}
                {row.jump && (
                  <button
                    type="button"
                    className="search-open-result"
                    data-search-result={row.id}
                    aria-disabled={!online}
                    onClick={(event) => {
                      if (online)
                        activate(
                          {
                            kind: selected === "posts" ? "post" : "file",
                            id: row.id,
                          },
                          event.currentTarget,
                          list.current?.scrollTop ?? 0,
                        );
                    }}
                  >
                    {selected === "posts"
                      ? row.title
                      : text.filePost(row.title)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {tab.status === "loading" && <p role="status">{text.loading}</p>}
        {tab.status === "ready" && rows.length === 0 && <p>{text.empty}</p>}
        {tab.status === "error" && (
          <p role="alert">{denied ? text.unavailable : text.failed}</p>
        )}
        {tab.status === "error" && !denied && online && (
          <button type="button" onClick={() => void session.retry()}>
            {text.retry}
          </button>
        )}
        {tab.status === "ready" && !tab.isEnd && online && (
          <button type="button" onClick={() => void session.more()}>
            {text.more}
          </button>
        )}
      </div>
    </aside>
  );
}
