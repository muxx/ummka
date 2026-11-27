import {
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { JoinedTeam } from "../mattermost/joined-teams.ts";
import type { SearchKind } from "./SearchResultsPanel.tsx";
import { SearchScopeNote, SearchScopeSelect } from "./SearchScopeSelect.tsx";
import { changeSearchScope } from "./search-conditions.ts";
import { searchCopy } from "./search-copy.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

export type SearchAccount = Pick<
  WorkspaceConnection,
  | "readJoinedTeams"
  | "readRecentTeamSearches"
  | "forgetTeamSearch"
  | "rememberTeamSearch"
  | "readSearchTimezone"
  | "readPostSearchPage"
  | "readFileSearchPage"
>;
export type SearchInput = {
  terms: string;
  scope: JoinedTeam | null;
  kind: SearchKind;
};

function RecentTerms({
  account,
  scope,
  language,
  choose,
  focusInput,
  list,
  visible,
}: {
  account: SearchAccount;
  scope: string;
  language: EntryLanguage;
  choose: (term: string) => void;
  focusInput: () => void;
  list: RefObject<HTMLUListElement | null>;
  visible: boolean;
}) {
  const [rows, setRows] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const active = useRef(false);
  const revision = useRef(0);
  const [removed, setRemoved] = useState("");
  const restore = useRef<number | null>(null);
  useLayoutEffect(() => {
    const next = restore.current;
    if (next === null) return;
    restore.current = null;
    const button =
      list.current?.children[Math.min(next, rows.length - 1)]?.querySelector(
        "button",
      );
    if (button) button.focus();
    else focusInput();
  }, [rows, focusInput, list]);
  const text = searchCopy[language];
  useEffect(() => {
    let live = true;
    active.current = true;
    account.readRecentTeamSearches(scope).then(
      (list) => {
        if (live) setRows(list);
      },
      () => {
        if (live) setError(true);
      },
    );
    return () => {
      live = false;
      active.current = false;
    };
  }, [account, scope]);
  async function forget(term: string) {
    let ticket: number | undefined;
    try {
      await account.forgetTeamSearch(scope, term);
      if (!active.current) return;
      // Reads are ordered by completed writes, even when clicks finish out of order.
      ticket = ++revision.current;
      const latest = await account.readRecentTeamSearches(scope);
      if (active.current && ticket === revision.current) {
        const focused = document.activeElement?.closest("li");
        if (
          list.current &&
          focused?.parentElement === list.current &&
          !latest.includes(focused.dataset.term ?? "")
        )
          restore.current = Array.from(list.current.children).indexOf(focused);
        setRows(latest);
        setRemoved(term);
        setError(false);
      }
    } catch {
      if (
        active.current &&
        (ticket === undefined || ticket === revision.current)
      )
        setError(true);
    }
  }
  return (
    <>
      {error && <p role="alert">{text.recentError}</p>}
      {visible && <span role="status">{removed && text.removed(removed)}</span>}
      {visible && rows.length > 0 && (
        <section aria-label={text.recent} className="search-recent">
          <h3>{text.recent}</h3>
          <ul ref={list}>
            {rows.map((term, index) => (
              <li key={term} data-term={term}>
                <button
                  type="button"
                  onClick={() => choose(term)}
                  onKeyDown={(event) => {
                    if (
                      event.nativeEvent.isComposing ||
                      event.keyCode === 229 ||
                      event.altKey ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey
                    )
                      return;
                    if (event.key === "Delete") {
                      event.preventDefault();
                      void forget(term);
                    } else if (
                      event.key === "ArrowUp" ||
                      event.key === "ArrowDown"
                    ) {
                      event.preventDefault();
                      const next = index + (event.key === "ArrowUp" ? -1 : 1);
                      if (next < 0) focusInput();
                      else
                        list.current?.children[next]
                          ?.querySelector("button")
                          ?.focus();
                    }
                  }}
                >
                  {term}
                </button>
                <button
                  type="button"
                  aria-label={`${text.forget}, ${term}`}
                  onClick={() => void forget(term)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function SearchDialog({
  account,
  team,
  allTeams,
  teams,
  directoryError,
  files,
  initial,
  language,
  close,
  submit,
  pending,
  issue,
}: {
  account: SearchAccount;
  team: JoinedTeam;
  allTeams: boolean;
  teams: readonly JoinedTeam[];
  directoryError: boolean;
  files: boolean;
  initial: SearchInput;
  language: EntryLanguage;
  close: () => void;
  submit: (query: SearchInput, removed: readonly string[]) => void;
  pending: boolean;
  issue: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const recents = useRef<HTMLUListElement>(null);
  const title = useId();
  const [terms, setTerms] = useState(initial.terms);
  const [chosenScope, setScope] = useState(initial.scope);
  const scope = allTeams ? chosenScope : team;
  const [kind, setKind] = useState<SearchKind>(files ? initial.kind : "posts");
  const selected = !allTeams
    ? team
    : scope && teams.find((option) => option.id === scope.id);
  const [removed, setRemoved] = useState<string[]>([]);
  const text = searchCopy[language];
  useLayoutEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    input.current?.focus();
    return () => modal?.close();
  }, []);
  function run(value: string, note = removed) {
    if (!value.trim() || pending || selected === undefined) return;
    submit(
      {
        terms: value.trim(),
        scope: selected,
        kind: files ? kind : "posts",
      },
      note,
    );
  }
  return (
    <dialog
      ref={dialog}
      className="channels-search-dialog modal-layout"
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id={title}>{text.title}</h2>
        <button
          className="channels-icon-action"
          type="button"
          aria-label={text.close}
          onClick={close}
        >
          ×
        </button>
      </header>
      <div className="modal-scroll">
        <search>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(terms);
            }}
          >
            {files && (
              <fieldset className="search-kind-switch" aria-label={text.open}>
                {(["posts", "files"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={k === kind}
                    onClick={() => {
                      setKind(k);
                      input.current?.focus();
                    }}
                  >
                    {text[k]}
                  </button>
                ))}
              </fieldset>
            )}
            {allTeams && (
              <SearchScopeSelect
                teams={teams}
                team={team}
                scope={scope}
                language={language}
                disabled={pending}
                change={(next) => {
                  const change = changeSearchScope(terms);
                  setScope(next);
                  setTerms(change.terms);
                  setRemoved(change.removed);
                  input.current?.focus();
                }}
              />
            )}
            {directoryError && <p role="alert">{text.readError}</p>}
            <div className="search-input-row">
              <input
                ref={input}
                type="search"
                autoComplete="off"
                enterKeyHint="search"
                aria-label={text.terms}
                value={terms}
                readOnly={pending}
                onChange={(e) => {
                  setTerms(e.target.value);
                  setRemoved([]);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (e.nativeEvent.isComposing || e.keyCode === 229)
                  )
                    e.preventDefault();
                  else if (
                    e.key === "ArrowDown" &&
                    !terms.trim() &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229 &&
                    !e.altKey &&
                    !e.ctrlKey &&
                    !e.metaKey &&
                    !e.shiftKey
                  ) {
                    const first = recents.current?.querySelector("button");
                    if (first) {
                      e.preventDefault();
                      first.focus();
                    }
                  }
                }}
              />
              <button
                type="submit"
                disabled={!terms.trim() || pending || selected === undefined}
              >
                {text.run}
              </button>
            </div>
            {removed.length > 0 && (
              <SearchScopeNote removed={removed} language={language} />
            )}
            {issue && <p role="alert">{issue}</p>}
          </form>
        </search>
        {selected && (
          <RecentTerms
            key={selected.id}
            account={account}
            scope={selected.id}
            language={language}
            list={recents}
            visible={!terms.trim()}
            focusInput={() => input.current?.focus()}
            choose={(term) => {
              setTerms(term);
              setRemoved([]);
              input.current?.focus();
              run(term, []);
            }}
          />
        )}
      </div>
    </dialog>
  );
}
