import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { TeamWorkspace } from "../entry/AccountTeamWindow.tsx";
import type { EntryLanguage } from "../entry/language.ts";
import { searchTimezoneOffsetSeconds } from "../mattermost/search-timezone.ts";
import type { SearchAccount, SearchInput } from "./SearchDialog.tsx";
import type { SearchSession } from "./SearchResultsPanel.tsx";
import { searchCopy } from "./search-copy.ts";
import { workspaceFailure } from "./workspace-data.ts";
import "./search.css";

const SearchDialog = lazy(async () => ({
  default: (await import("./SearchDialog.tsx")).SearchDialog,
}));
const SearchResultsPanel = lazy(async () => ({
  default: (await import("./SearchResultsPanel.tsx")).SearchResultsPanel,
}));

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
  channelName: (id: string) => string | undefined,
  authorName: (id: string) => string | undefined,
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<{
    query: SearchInput;
    result: SearchSession;
    policyKey: string;
  } | null>(null);
  const request = useRef<AbortController | null>(null);
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
    request.current?.abort();
    request.current = null;
    setPending(false);
    if (result.current) {
      result.current.close();
      result.current = null;
      setEntry(null);
      if (!open) trigger.current?.focus();
    }
  }, [policyKey, open, clearPosition]);
  useEffect(
    () => () => {
      request.current?.abort();
      activation.current?.controller.abort();
      result.current?.close();
    },
    [],
  );
  function closeDialog() {
    request.current?.abort();
    request.current = null;
    setPending(false);
    setError(null);
    // The modal makes its opener inert until React commits the dismissal.
    if (open) restoreTrigger.current = true;
    else trigger.current?.focus();
    setForm(null);
  }
  function abandonDestination() {
    activation.current?.controller.abort();
    activation.current = null;
    sourceRow.current = null;
    setRestore(null);
    clearPosition();
  }
  function dismiss() {
    abandonDestination();
    closeDialog();
    result.current?.close();
    result.current = null;
    setEntry(null);
  }
  function currentQuery(): SearchInput {
    return {
      terms: entry?.query.terms ?? "",
      scope: settings?.allTeams && entry ? entry.query.scope : team,
      kind:
        settings?.files && entry
          ? entry.result.getSnapshot().selected
          : "posts",
    };
  }
  function edit() {
    navigation.beforeOpen?.();
    abandonDestination();
    setError(null);
    setForm(currentQuery());
  }
  async function run(
    query: SearchInput,
    origin?: AbortSignal,
    onOpened?: () => void,
  ) {
    if (request.current || origin?.aborted) return false;
    abandonDestination();
    const token = new AbortController();
    const leaveOrigin = () => {
      token.abort();
      if (request.current === token) setForm(null);
    };
    origin?.addEventListener("abort", leaveOrigin, { once: true });
    request.current = token;
    setPending(true);
    setError(null);
    let source: "storage" | "network" = "storage";
    try {
      if (
        query.scope &&
        !(await connection.rememberTeamSearch(query.scope.id, query.terms))
      )
        throw Error("Team no longer present");
      token.signal.throwIfAborted();
      if (!online) {
        setError(text.offline);
        return false;
      }
      if (!settings) {
        setError(text.readError);
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
      onOpened?.();
      setEntry({ query, result: session, policyKey });
      setForm(null);
      void session.select(query.kind);
      return true;
    } catch (cause) {
      if (token.signal.aborted) return false;
      const failure = workspaceFailure(cause, source);
      if (failure === "session" || failure === "unauthorized")
        sessionIssue(failure);
      else setError(source === "storage" ? text.saveError : text.readError);
      return false;
    } finally {
      origin?.removeEventListener("abort", leaveOrigin);
      if (request.current === token) {
        request.current = null;
        setPending(false);
      }
    }
  }
  return {
    origin: sourceRow.current,
    backLabel: text.back,
    restoreRow: () => {
      const origin = sourceRow.current;
      setRestore(origin);
      return origin?.channelId;
    },
    dismiss,
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
      if (request.current || origin.aborted) return false;
      navigation.beforeOpen?.();
      const query = { ...currentQuery(), terms: terms.trim() };
      setError(null);
      if (!query.terms) onOpened();
      setForm(query);
      return query.terms ? run(query, origin, onOpened) : true;
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
        <span>{entry?.query.terms ?? text.open}</span>
      </button>
    ),
    dialog: form && (
      <Suspense fallback={null}>
        <SearchDialog
          account={connection}
          team={team}
          initial={form}
          allTeams={settings?.allTeams === true}
          files={settings?.files === true}
          language={language}
          issue={error}
          close={closeDialog}
          pending={pending}
          submit={(query) => void run(query)}
        />
      </Suspense>
    ),
    panel: entry && entry.policyKey === policyKey && (
      <Suspense fallback={null}>
        <SearchResultsPanel
          key={JSON.stringify(entry.query)}
          session={entry.result}
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
          channelName={channelName}
          authorName={authorName}
          edit={edit}
          dismiss={dismiss}
          sessionIssue={sessionIssue}
        />
      </Suspense>
    ),
  };
}
