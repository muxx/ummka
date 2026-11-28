import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ResponseError } from "../../vendor/mattermost/index.js";
import type { EntryLanguage } from "../entry/language.ts";
import type { JoinedTeam } from "../mattermost/joined-teams.ts";
import { useCollectionRefreshVisibility } from "./CollectionReadNotice.tsx";
import { PanelRetry, PanelState } from "./PanelState.tsx";
import { PaneSizeToggle } from "./PaneWidthControls.tsx";
import { SearchFileResult, SearchPostResult } from "./SearchResultRow.tsx";
import { SearchScopeNote, SearchScopeSelect } from "./SearchScopeSelect.tsx";
import { type SearchCondition, searchConditions } from "./search-conditions.ts";
import { searchCopy } from "./search-copy.ts";
import { searchResultPatterns } from "./search-result-text.ts";
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
  const tabAction = useRef<HTMLButtonElement>(null);
  const waitingNotice = useRef<HTMLDivElement>(null);
  const waitingFocus = useRef<{ kind: SearchKind; rowCount: number } | null>(
    null,
  );
  const [retrying, setRetrying] = useState(false);
  const opening = useRef({ restore, focus });
  const status =
    tab?.error instanceof ResponseError ? tab.error.response.status : null;
  const denied = status === 401 || status === 403 || status === 404;
  const loading = pending || tab?.status === "loading";
  const hasRows = !denied && Boolean(tab?.items.length);
  const failed = tab?.status === "error";
  const empty = tab?.status === "ready" && !hasRows;
  const scopeName = scope ? scope.displayName || scope.name : null;
  const failedIn = text.failedIn(scopeName);
  const showRefresh = useCollectionRefreshVisibility(loading && hasRows);
  const canContinue = hasRows && online && !tab?.isEnd;
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
  useLayoutEffect(() => {
    const waiting = waitingFocus.current;
    if (!waiting) return;
    if (waiting.kind !== selected) {
      waitingFocus.current = null;
      return;
    }
    const active = document.activeElement;
    if (loading) {
      if (active === document.body) waitingNotice.current?.focus();
      return;
    }
    waitingFocus.current = null;
    if (active !== document.body && active !== waitingNotice.current) return;
    const matches = list.current?.querySelectorAll<HTMLButtonElement>(
      "[data-search-result]",
    );
    const result =
      matches?.item(waiting.rowCount) ?? matches?.item(matches.length - 1);
    (tabAction.current ?? result ?? summary.current)?.focus();
  }, [loading, selected]);
  function requestTab(action: "more" | "retry") {
    if (!session || loading) return;
    if (document.activeElement === tabAction.current)
      waitingFocus.current = {
        kind: selected,
        rowCount:
          list.current?.querySelectorAll("[data-search-result]").length ?? 0,
      };
    if (action === "more") void session.more();
    else void session.retry();
  }
  const patterns = useMemo(() => searchResultPatterns(terms), [terms]);
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
        aria-busy={loading}
      >
        {!online && (
          <p
            className="panel-text--secondary search-result-explanation"
            role="status"
          >
            {text.offline}
          </p>
        )}
        {tab && tab.retentionTime > 0 && (
          <p className="panel-text--secondary search-result-explanation">
            {text.retention}
          </p>
        )}
        {loading && !hasRows && (
          <PanelState
            variant="pending"
            ref={waitingNotice}
            role="status"
            message={text.loading(scopeName)}
          />
        )}
        {empty && (
          <PanelState
            variant="empty"
            title={text.empty(terms)}
            message={
              filesAllowed ? text.emptyWithTab(selected) : text.emptyHint
            }
            action={
              <button
                type="button"
                className="panel-state__action search-edit-link"
                onClick={edit}
              >
                {text.edit}
              </button>
            }
          />
        )}
        {!terms && (
          <PanelState
            variant="empty"
            title={text.emptyQuery}
            message={text.emptyQueryHint}
          />
        )}
        {(issue || retrying) && online && (
          <PanelState
            variant="error"
            title={
              issue && (
                <span role="alert">
                  {issue === text.failed ? failedIn : issue}
                </span>
              )
            }
            action={
              <PanelRetry
                ref={retryControl}
                aria-disabled={pending}
                onClick={() => {
                  if (pending) return;
                  setRetrying(true);
                  retry();
                }}
              >
                {text.retry}
              </PanelRetry>
            }
          />
        )}
        {failed && !hasRows && (
          <PanelState
            variant="error"
            title={
              <span role="alert">{denied ? text.unavailable : failedIn}</span>
            }
            action={
              !denied &&
              online && (
                <PanelRetry ref={tabAction} onClick={() => requestTab("retry")}>
                  {text.retry}
                </PanelRetry>
              )
            }
          />
        )}
        {hasRows && (
          <ul>
            {selected === "posts"
              ? state?.posts.items.map((row) => (
                  <SearchPostResult
                    key={row.id}
                    row={row}
                    author={row.userId ? authorName(row.userId) : undefined}
                    channel={channelName(row.channelId)}
                    language={language}
                    pattern={patterns.post}
                    matches={state.posts.matches?.[row.id]}
                    online={online}
                    restored={restore?.id === row.id}
                    open={(button) =>
                      activate(
                        { kind: "post", id: row.id },
                        button,
                        list.current?.scrollTop ?? 0,
                      )
                    }
                  />
                ))
              : state?.files.items.map((row) => (
                  <SearchFileResult
                    key={row.id}
                    row={row}
                    author={row.userId ? authorName(row.userId) : undefined}
                    channel={channelName(row.channelId)}
                    language={language}
                    pattern={patterns.file}
                    online={online}
                    restored={restore?.id === row.id}
                    open={(button) =>
                      activate(
                        { kind: "file", id: row.id },
                        button,
                        list.current?.scrollTop ?? 0,
                      )
                    }
                  />
                ))}
          </ul>
        )}
        {hasRows && (showRefresh || canContinue || failed) && (
          <div className="search-result-edge">
            {showRefresh && (
              <PanelState
                variant="refresh"
                message={text.updating}
                role="status"
              />
            )}
            {(canContinue || failed) && (
              <PanelState
                variant={failed ? "stale" : "empty"}
                role={failed ? "alert" : undefined}
                message={failed ? text.failed : undefined}
                action={
                  canContinue && (
                    <PanelRetry
                      ref={tabAction}
                      aria-disabled={loading}
                      onClick={() => requestTab(failed ? "retry" : "more")}
                    >
                      {failed ? text.retry : text.more}
                    </PanelRetry>
                  )
                }
              />
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
