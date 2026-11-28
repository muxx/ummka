import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ResponseError } from "../../vendor/mattermost/index.js";
import type { TeamWorkspace } from "../entry/AccountTeamWindow.tsx";
import type { EntryLanguage } from "../entry/language.ts";
import type { JoinedTeam } from "../mattermost/joined-teams.ts";
import { searchTimezoneOffsetSeconds } from "../mattermost/search-timezone.ts";
import type { SearchAccount, SearchInput } from "./SearchDialog.tsx";
import type { SearchPanelFocus, SearchSession } from "./SearchResultsPanel.tsx";
import {
  changeSearchScope,
  removeSearchConditions,
} from "./search-conditions.ts";
import { searchCopy } from "./search-copy.ts";
import { workspaceFailure } from "./workspace-data.ts";
import "./search.css";

const SearchDialog = lazy(async () => ({
  default: (await import("./SearchDialog.tsx")).SearchDialog,
}));
const SearchResultsPanel = lazy(async () => ({
  default: (await import("./SearchResultsPanel.tsx")).SearchResultsPanel,
}));

const noSubscription = () => () => {};
const noResults = () => null;

type SearchEdit = { removed: readonly string[]; focus?: SearchPanelFocus };
type SearchOwner = "dialog" | "results";
type SearchRun =
  | {
      owner: "dialog";
      origin?: AbortSignal;
      onOpened?: () => void;
      removed?: readonly string[];
    }
  | ({ owner: "results" } & SearchEdit);

export function useWorkspaceSearch(
  workspace: Pick<TeamWorkspace, "team" | "online" | "sessionIssue"> & {
    connection: SearchAccount;
    policy: {
      server: {
        value: Pick<
          NonNullable<TeamWorkspace["policy"]["server"]["value"]>,
          "search"
        > | null;
      };
    };
  },
  language: EntryLanguage,
  names: {
    channel: (id: string) => string | undefined;
    author: (id: string) => string | undefined;
    condition: (
      kind: "channel" | "author",
      value: string,
    ) => string | undefined;
  },
  navigation: {
    channelId: string | null;
    open: (
      source: { kind: "post" | "file"; id: string },
      signal: AbortSignal,
      origin: HTMLElement,
    ) => Promise<void>;
    clear: () => void;
    beforeOpen?: () => void;
  },
) {
  const { team, connection, online, policy, sessionIssue } = workspace;
  const settings = policy.server.value?.search;
  const policyKey = settings
    ? [settings.allTeams, settings.files, settings.archivedChannels].join("/")
    : "";
  const text = searchCopy[language];
  const [form, setForm] = useState<SearchInput | null>(null);
  const open = form !== null;
  const [pending, setPending] = useState<SearchOwner | null>(null);
  const [issues, setIssues] = useState<Partial<Record<SearchOwner, string>>>(
    {},
  );
  const [directory, setDirectory] = useState<{
    teams: readonly JoinedTeam[];
    failed: boolean;
  } | null>(null);
  const [entry, setEntry] = useState<
    | ({
        query: SearchInput;
        result: SearchSession | null;
        policyKey: string;
      } & SearchEdit)
    | null
  >(null);
  const allTeams = settings?.allTeams === true;
  const loadTeams = allTeams && (open || entry !== null);
  const teamRead = useRef<{
    connection: SearchAccount;
    team: JoinedTeam;
    token: AbortController;
  } | null>(null);
  const teams =
    directory?.teams ??
    (form?.scope && form.scope.id !== team.id ? [team, form.scope] : [team]);
  const canChooseResultScope =
    allTeams &&
    (teams.length > 1 || (entry && entry.query.scope?.id !== team.id));
  useEffect(() => () => teamRead.current?.token.abort(), []);
  useEffect(() => {
    const previous = teamRead.current;
    if (!loadTeams) {
      previous?.token.abort();
      teamRead.current = null;
      return;
    }
    // A lookup begun in the editor can finish in the results pane.
    if (
      !open &&
      previous?.connection === connection &&
      previous.team === team &&
      !previous.token.signal.aborted
    )
      return;
    previous?.token.abort();
    const read = new AbortController();
    teamRead.current = { connection, team, token: read };
    connection.readJoinedTeams().then(
      (saved) => {
        if (!read.signal.aborted && saved)
          setDirectory({ teams: saved.teams, failed: false });
      },
      () => {
        if (!read.signal.aborted) setDirectory({ teams: [team], failed: true });
      },
    );
  }, [loadTeams, open, connection, team]);
  const request = useRef<{ token: AbortController; owner: SearchOwner } | null>(
    null,
  );
  const result = useRef<SearchSession | null>(null);
  const activation = useRef<{
    kind: "post" | "file";
    id: string;
    controller: AbortController;
  } | null>(null);
  const sourceRow = useRef<{
    id: string;
    channelId: string;
    scroll: number;
  } | null>(null);
  const [restore, setRestore] = useState<{ id: string; scroll: number } | null>(
    null,
  );
  const clearPosition = navigation.clear;
  const trigger = useRef<HTMLButtonElement>(null);
  const previousPolicy = useRef(policyKey);
  const restoreTrigger = useRef(false);
  useLayoutEffect(() => {
    if (!open && restoreTrigger.current) {
      restoreTrigger.current = false;
      trigger.current?.focus();
    }
  }, [open]);
  useLayoutEffect(() => {
    if (previousPolicy.current === policyKey) return;
    previousPolicy.current = policyKey;
    activation.current?.controller.abort();
    sourceRow.current = null;
    setRestore(null);
    if (result.current || activation.current) clearPosition();
    request.current?.token.abort();
    request.current = null;
    setPending(null);
    setIssues({});
    if (result.current) {
      result.current.close();
      result.current = null;
      if (!open) trigger.current?.focus();
    }
    setEntry(null);
  }, [policyKey, open, clearPosition]);
  useEffect(
    () => () => {
      request.current?.token.abort();
      activation.current?.controller.abort();
      result.current?.close();
    },
    [],
  );
  function closeDialog() {
    if (request.current?.owner === "dialog") {
      request.current.token.abort();
      request.current = null;
      setPending(null);
    }
    setIssues((current) => ({ ...current, dialog: undefined }));
    // The modal makes its opener inert until React commits the dismissal.
    if (open) restoreTrigger.current = true;
    else trigger.current?.focus();
    setForm(null);
  }
  function clearResultSource() {
    activation.current?.controller.abort();
    activation.current = null;
    sourceRow.current = null;
    setRestore(null);
  }
  function abandonDestination() {
    clearResultSource();
    clearPosition();
  }
  function leaveResults() {
    clearResultSource();
    request.current?.token.abort();
    request.current = null;
    setPending(null);
    setForm(null);
    setIssues({});
    result.current?.close();
    result.current = null;
    setEntry(null);
  }
  function dismiss() {
    clearPosition();
    closeDialog();
    leaveResults();
  }
  function currentQuery(): SearchInput {
    return {
      terms: entry?.query.terms ?? "",
      scope: settings?.allTeams && entry ? entry.query.scope : team,
      kind:
        settings?.files && entry
          ? (entry.result?.getSnapshot().selected ?? entry.query.kind)
          : "posts",
    };
  }
  function edit() {
    navigation.beforeOpen?.();
    abandonDestination();
    setIssues((current) => ({ ...current, dialog: undefined }));
    setForm(currentQuery());
  }
  async function run(query: SearchInput, options: SearchRun) {
    const { owner, removed = [] } = options;
    const panel = owner === "results";
    const origin = options.owner === "dialog" ? options.origin : undefined;
    if ((!panel && request.current?.owner === "dialog") || origin?.aborted)
      return false;
    abandonDestination();
    const focus = options.owner === "results" ? options.focus : undefined;
    const interrupted = !panel && request.current?.owner === "results";
    setIssues((current) => ({
      ...current,
      [owner]: undefined,
      ...(interrupted ? { results: text.interrupted } : {}),
    }));
    request.current?.token.abort();
    request.current = null;
    if (panel) {
      result.current?.close();
      result.current = null;
      setEntry({ query, result: null, policyKey, removed, focus });
      if (!query.terms) {
        setPending(null);
        return true;
      }
    }
    const issue = (message: string) =>
      setIssues((current) => ({ ...current, [owner]: message }));
    const token = new AbortController();
    const leaveOrigin = () => {
      token.abort();
      if (request.current?.token === token) setForm(null);
    };
    origin?.addEventListener("abort", leaveOrigin, { once: true });
    request.current = { token, owner };
    setPending(owner);
    let source: "storage" | "network" = "storage";
    try {
      if (
        query.scope &&
        !(await connection.rememberTeamSearch(query.scope.id, query.terms))
      )
        throw Error("Team no longer present");
      token.signal.throwIfAborted();
      if (!online) {
        issue(text.offline);
        return false;
      }
      if (!settings) {
        issue(text.readError);
        return false;
      }
      source = "network";
      const [timeZone, { openSearchResults }] = await Promise.all([
        connection.readSearchTimezone(token.signal),
        import("./search-results-session.ts"),
      ]);
      token.signal.throwIfAborted();
      const offset = searchTimezoneOffsetSeconds(timeZone);
      const session = openSearchResults(connection, {
        teamId: query.scope?.id ?? null,
        terms: query.terms,
        isOrSearch: false,
        includeDeletedChannels: settings.archivedChannels,
        timeZoneOffsetSeconds: offset,
      });
      result.current?.close();
      result.current = session;
      if (options.owner === "dialog") {
        options.onOpened?.();
        setIssues({});
        setForm(null);
      }
      setEntry({ query, result: session, policyKey, removed, focus });
      void session.select(query.kind);
      return true;
    } catch (cause) {
      if (token.signal.aborted) return false;
      const failure = workspaceFailure(cause, source);
      if (failure === "session" || failure === "unauthorized")
        sessionIssue(failure);
      else if (source === "storage") issue(text.saveError);
      else if (failure === "forbidden") issue(text.unavailable);
      else issue(panel ? text.failed : text.readError);
      return false;
    } finally {
      origin?.removeEventListener("abort", leaveOrigin);
      if (request.current?.token === token) {
        request.current = null;
        setPending(null);
      }
    }
  }
  const session = entry?.policyKey === policyKey ? entry.result : null;
  const state = useSyncExternalStore(
    session?.subscribe ?? noSubscription,
    session?.getSnapshot ?? noResults,
  );
  const tab = state?.[state.selected];
  const denied =
    tab?.error instanceof ResponseError &&
    [401, 403, 404].includes(tab.error.response.status);
  const scopeLabel =
    entry && entry.query.scope?.id !== team.id
      ? entry.query.scope?.displayName || entry.query.scope?.name || text.all
      : null;
  return {
    session,
    rows: denied ? undefined : tab?.items,
    origin: sourceRow.current,
    backLabel: text.back,
    restoreRow: () => {
      const origin = sourceRow.current;
      setRestore(origin);
      return origin?.channelId;
    },
    dismiss,
    leaveResults,
    abortPending: () => activation.current?.controller.abort(),
    back: open
      ? closeDialog
      : entry && entry.policyKey === policyKey
        ? dismiss
        : null,
    async fromCommand(
      terms: string,
      origin: AbortSignal,
      onOpened: () => void,
    ) {
      if (request.current?.owner === "dialog" || origin.aborted) return false;
      navigation.beforeOpen?.();
      const query = { ...currentQuery(), terms: terms.trim() };
      setIssues((current) => ({ ...current, dialog: undefined }));
      if (!query.terms) onOpened();
      setForm(query);
      return query.terms
        ? run(query, { owner: "dialog", origin, onOpened })
        : true;
    },
    trigger: (
      <button
        ref={trigger}
        className="channels-search-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-label={text.open}
        onClick={edit}
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        >
          <circle cx="10" cy="10" r="6.5" />
          <path d="m15 15 5 5" />
        </svg>
        <span>
          {entry?.query.terms || text.open}
          {entry?.query.terms && scopeLabel && ` · ${scopeLabel}`}
        </span>
      </button>
    ),
    dialog: form && (
      <Suspense fallback={null}>
        <SearchDialog
          account={connection}
          team={team}
          initial={form}
          allTeams={allTeams}
          teams={teams}
          directoryError={allTeams && directory?.failed === true}
          files={settings?.files === true}
          language={language}
          issue={issues.dialog ?? null}
          close={closeDialog}
          pending={pending === "dialog"}
          submit={(query, removed) =>
            void run(query, { owner: "dialog", removed })
          }
        />
      </Suspense>
    ),
    panel: entry && entry.policyKey === policyKey && (
      <Suspense fallback={null}>
        <SearchResultsPanel
          key={JSON.stringify(entry.query)}
          session={entry.result}
          kind={entry.query.kind}
          pending={pending === "results"}
          issue={issues.results ?? null}
          retry={() =>
            void run(entry.query, {
              owner: "results",
              removed: entry.removed,
              focus: entry.focus,
            })
          }
          removed={entry.removed}
          focus={entry.focus}
          scope={entry.query.scope}
          team={team}
          teams={canChooseResultScope ? teams : undefined}
          changeScope={(scope) => {
            const change = changeSearchScope(entry.query.terms);
            void run(
              { ...currentQuery(), scope, terms: change.terms },
              {
                owner: "results",
                removed: change.removed,
                focus: { kind: "scope" },
              },
            );
          }}
          removeCondition={(condition, index) => {
            void run(
              {
                ...currentQuery(),
                terms: removeSearchConditions(entry.query.terms, [condition]),
              },
              {
                owner: "results",
                removed: [],
                focus: { kind: "filter", index },
              },
            );
          }}
          conditionName={(kind, value) =>
            entry.query.scope?.id === team.id
              ? names.condition(kind, value)
              : undefined
          }
          restore={restore}
          activate={async (source, origin, scroll) => {
            if (!navigation.channelId) return;
            if (
              activation.current?.id === source.id &&
              activation.current.kind === source.kind
            )
              return;
            activation.current?.controller.abort();
            const task = new AbortController();
            activation.current = { ...source, controller: task };
            sourceRow.current = {
              id: source.id,
              channelId: navigation.channelId,
              scroll,
            };
            try {
              await navigation.open(source, task.signal, origin);
            } finally {
              if (activation.current?.controller === task)
                activation.current = null;
            }
          }}
          terms={entry.query.terms}
          filesAllowed={settings?.files === true}
          language={language}
          online={online}
          channelName={names.channel}
          authorName={names.author}
          edit={edit}
          dismiss={dismiss}
          sessionIssue={sessionIssue}
        />
      </Suspense>
    ),
  };
}
