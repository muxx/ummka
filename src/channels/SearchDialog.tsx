import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { JoinedTeam } from "../mattermost/joined-teams.ts";
import type { SearchKind } from "./SearchResultsPanel.tsx";
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
}: {
  account: SearchAccount;
  scope: string;
  language: EntryLanguage;
  choose: (term: string) => void;
  focusInput: () => void;
}) {
  const [rows, setRows] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const active = useRef(false);
  const revision = useRef(0);
  const list = useRef<HTMLUListElement>(null);
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
  }, [rows, focusInput]);
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
      {rows.length > 0 && (
        <section aria-label={text.recent} className="search-recent">
          <h3>{text.recent}</h3>
          <ul ref={list}>
            {rows.map((term) => (
              <li key={term} data-term={term}>
                <button type="button" onClick={() => choose(term)}>
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
  files: boolean;
  initial: SearchInput;
  language: EntryLanguage;
  close: () => void;
  submit: (query: SearchInput) => void;
  pending: boolean;
  issue: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const title = useId();
  const [terms, setTerms] = useState(initial.terms);
  const [chosenScope, setScope] = useState(initial.scope);
  const scope = allTeams ? chosenScope : team;
  const [kind, setKind] = useState<SearchKind>(files ? initial.kind : "posts");
  const [teams, setTeams] = useState<JoinedTeam[]>(() =>
    scope && scope.id !== team.id ? [team, scope] : [team],
  );
  const selected = !allTeams
    ? team
    : scope && teams.find((option) => option.id === scope.id);
  const [directoryError, setDirectoryError] = useState(false);
  const text = searchCopy[language];
  useLayoutEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    input.current?.focus();
    return () => modal?.close();
  }, []);
  useEffect(() => {
    if (!allTeams) return;
    let live = true;
    account.readJoinedTeams().then(
      (result) => {
        if (live && result) setTeams(result.teams);
      },
      () => {
        if (live) setDirectoryError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [account, allTeams]);
  function run(value: string) {
    if (!value.trim() || pending || selected === undefined) return;
    submit({
      terms: value.trim(),
      scope: selected,
      kind: files ? kind : "posts",
    });
  }
  return (
    <dialog
      ref={dialog}
      className="channels-search-dialog"
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
            <label className="search-scope">
              {text.scope}
              <select
                value={scope?.id ?? ""}
                disabled={pending}
                onChange={(e) => {
                  const id = e.currentTarget.value;
                  setScope(teams.find((option) => option.id === id) ?? null);
                  setTerms(
                    terms
                      .replace(/\b(?:in|from):[^\s]*/gi, "")
                      .replace(/\s{2,}/g, " ")
                      .trim(),
                  );
                  input.current?.focus();
                }}
              >
                {selected === undefined && scope && (
                  <option value={scope.id} disabled>
                    {scope.displayName || scope.name} · {text.teamUnavailable}
                  </option>
                )}
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName || t.name}
                  </option>
                ))}
                <option value="">{text.all}</option>
              </select>
            </label>
          )}
          {allTeams && directoryError && <p role="alert">{text.readError}</p>}
          <div className="search-input-row">
            <input
              ref={input}
              type="search"
              autoComplete="off"
              enterKeyHint="search"
              aria-label={text.terms}
              value={terms}
              disabled={pending}
              onChange={(e) => setTerms(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.nativeEvent.isComposing || e.keyCode === 229)
                )
                  e.preventDefault();
              }}
            />
            <button
              type="submit"
              disabled={!terms.trim() || pending || selected === undefined}
            >
              {text.run}
            </button>
          </div>
          {issue && <p role="alert">{issue}</p>}
        </form>
      </search>
      {selected && (
        <RecentTerms
          key={selected.id}
          account={account}
          scope={selected.id}
          language={language}
          focusInput={() => input.current?.focus()}
          choose={(term) => {
            setTerms(term);
            input.current?.focus();
          }}
        />
      )}
    </dialog>
  );
}
