import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ResponseError } from "../../vendor/mattermost/index.js";
import type { EntryLanguage } from "../entry/language.ts";
import type { JoinedTeam } from "../mattermost/joined-teams.ts";
import { PaneSizeToggle } from "./PaneWidthControls.tsx";
import { SearchScopeNote, SearchScopeSelect } from "./SearchScopeSelect.tsx";
import { type SearchCondition, searchConditions } from "./search-conditions.ts";
import { searchCopy } from "./search-copy.ts";
import type { openSearchResults } from "./search-results-session.ts";

export type SearchSession = ReturnType<typeof openSearchResults>;
export type SearchKind = "posts" | "files";
export type SearchPanelFocus =
  | { kind: "filter"; index: number }
  | { kind: "scope" };

const subscribeNothing = () => () => {};
const noResults = () => null;

function conditionLabel(
  condition: SearchCondition,
  language: EntryLanguage,
  name: (kind: "channel" | "author", value: string) => string | undefined,
) {
  const text = searchCopy[language].filter;
  const key = condition.key === "channel" ? "in" : condition.key;
  let value = condition.value;
  if (key === "in") {
    value = value.replace(/^[#~]/, "");
    return text.in(
      "# " + (name("channel", value) ?? value),
      condition.excluded,
    );
  } else if (key === "from") {
    value = value.replace(/^@/, "");
    return text.from(name("author", value) ?? "@" + value, condition.excluded);
  } else if (key === "ext" && !value.startsWith(".")) {
    value = "." + value;
  }
  const label = text[key](value);
  return condition.excluded ? text.exclude(label) : label;
}

export function SearchResultsPanel({
  session,
  terms,
  kind,
  pending,
  issue,
  retry,
  removed,
  focus,
  scope,
  team,
  teams,
  changeScope,
  removeCondition,
  conditionName,
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
  session: SearchSession | null;
  terms: string;
  kind: SearchKind;
  pending: boolean;
  issue: string | null;
  retry: () => void;
  removed: readonly string[];
  focus?: SearchPanelFocus;
  scope: JoinedTeam | null;
  team: JoinedTeam;
  teams?: readonly JoinedTeam[];
  changeScope: (value: JoinedTeam | null) => void;
  removeCondition: (condition: SearchCondition, index: number) => void;
  conditionName: (
    kind: "channel" | "author",
    value: string,
  ) => string | undefined;
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
  const state = useSyncExternalStore(
    session?.subscribe ?? subscribeNothing,
    session?.getSnapshot ?? noResults,
  );
  const selected = state?.selected ?? kind;
  const tab = state?.[selected];
  const text = searchCopy[language];
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLButtonElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const retryControl = useRef<HTMLButtonElement>(null);
  const [retrying, setRetrying] = useState(false);
  const opening = useRef({ restore, focus });
  const status =
    tab?.error instanceof ResponseError ? tab.error.response.status : null;
  const denied = status === 401 || status === 403 || status === 404;
  useEffect(() => {
    const { restore: destination, focus: target } = opening.current;
    const row =
      destination &&
      list.current?.querySelector<HTMLButtonElement>(
        `[data-search-result="${CSS.escape(destination.id)}"]`,
      );
    if (list.current && destination && row) {
      list.current.scrollTop = destination.scroll;
      row.focus({ preventScroll: true });
    } else if (target) {
      const chips =
        controls.current?.querySelectorAll<HTMLButtonElement>(
          ".search-condition",
        );
      const next =
        target.kind === "scope"
          ? controls.current?.querySelector("select")
          : chips?.[Math.min(target.index, chips.length - 1)];
      (next ?? summary.current)?.focus({ preventScroll: true });
    } else heading.current?.focus();
  }, []);
  useEffect(() => {
    if (status === 401) sessionIssue("unauthorized");
  }, [status, sessionIssue]);
  useLayoutEffect(() => {
    if (!retrying || pending) return;
    if (!issue && document.activeElement === retryControl.current)
      summary.current?.focus({ preventScroll: true });
    setRetrying(false);
  }, [issue, pending, retrying]);
  const rows =
    selected === "posts"
      ? state?.posts.items.map((row) => ({
          id: row.id,
          jump: true,
          title: row.message || text.attachment,
          name: row.userId && authorName(row.userId),
          channel: channelName(row.channelId),
        }))
      : state?.files.items.map((row) => ({
          id: row.id,
          jump: Boolean(row.postId),
          title: row.name || text.unnamed,
          name: row.userId && authorName(row.userId),
          channel: channelName(row.channelId),
        }));
  const conditions = searchConditions(terms);
  return (
    <aside className="search-results-pane" aria-labelledby={id}>
      <header className="channels-pane-head">
        <h2 id={id} ref={heading} tabIndex={-1}>
          {text.results}
        </h2>
        <PaneSizeToggle />
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
        ref={summary}
        type="button"
        className="search-query-summary"
        aria-label={terms ? text.edit + ", " + terms : text.edit}
        onClick={edit}
      >
        {terms || text.open}
      </button>
      {filesAllowed && (
        <fieldset className="search-kind-switch" aria-label={text.results}>
          {(["posts", "files"] as const).map((kind) => (
            <button
              type="button"
              key={kind}
              aria-pressed={selected === kind}
              disabled={
                !session || (!online && state?.[kind].status === "idle")
              }
              onClick={() => void session?.select(kind)}
            >
              {text[kind]}
              {state &&
                state[kind].items.length > 0 &&
                " · " + state[kind].items.length}
            </button>
          ))}
        </fieldset>
      )}
      <div className="search-result-conditions" ref={controls}>
        {teams && (
          <SearchScopeSelect
            team={team}
            teams={teams}
            scope={scope}
            language={language}
            change={changeScope}
          />
        )}
        {removed.length > 0 && (
          <SearchScopeNote removed={removed} language={language} />
        )}
        {conditions.length > 0 && (
          <fieldset className="search-conditions" aria-label={text.filters}>
            <span aria-hidden="true">{text.filters}</span>
            {conditions.map((condition, index) => {
              const label = conditionLabel(condition, language, conditionName);
              return (
                <button
                  key={condition.start}
                  type="button"
                  className="search-condition"
                  aria-label={text.removeFilter(label)}
                  onClick={() => removeCondition(condition, index)}
                >
                  <span>{label}</span>
                  <span aria-hidden="true">×</span>
                </button>
              );
            })}
          </fieldset>
        )}
      </div>
      <div
        ref={list}
        className="channels-pane-body search-result-list"
        aria-busy={pending || tab?.status === "loading"}
      >
        {!online && <p role="status">{text.offline}</p>}
        {tab && tab.retentionTime > 0 && <p>{text.retention}</p>}
        {!denied && rows && rows.length > 0 && (
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
        {(pending || tab?.status === "loading") && (
          <p role="status">{text.loading}</p>
        )}
        {tab?.status === "ready" && rows?.length === 0 && <p>{text.empty}</p>}
        {!terms && <p>{text.emptyQuery}</p>}
        {(issue || retrying) && online && (
          <>
            {issue && <p role="alert">{issue}</p>}
            <button
              ref={retryControl}
              type="button"
              aria-disabled={pending}
              onClick={() => {
                if (pending) return;
                setRetrying(true);
                retry();
              }}
            >
              {text.retry}
            </button>
          </>
        )}
        {tab?.status === "error" && (
          <p role="alert">{denied ? text.unavailable : text.failed}</p>
        )}
        {tab?.status === "error" && !denied && online && (
          <button type="button" onClick={() => void session?.retry()}>
            {text.retry}
          </button>
        )}
        {tab?.status === "ready" && !tab.isEnd && online && (
          <button type="button" onClick={() => void session?.more()}>
            {text.more}
          </button>
        )}
      </div>
    </aside>
  );
}
