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
) {
  const { team, connection, online, policy, sessionIssue } = workspace;
  const settings = policy.server.value?.search;
  const policyKey = settings
    ? [settings.allTeams, settings.files, settings.archivedChannels].join("/")
    : "";
  const text = searchCopy[language];
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<{
    query: SearchInput;
    result: SearchSession;
    policyKey: string;
  } | null>(null);
  const request = useRef<AbortController | null>(null);
  const result = useRef<SearchSession | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const previousPolicy = useRef(policyKey);
  useLayoutEffect(() => {
    if (previousPolicy.current === policyKey) return;
    previousPolicy.current = policyKey;
    request.current?.abort();
    request.current = null;
    setPending(false);
    if (result.current) {
      result.current.close();
      result.current = null;
      setEntry(null);
      if (!open) trigger.current?.focus();
    }
  }, [policyKey, open]);
  useEffect(
    () => () => {
      request.current?.abort();
      result.current?.close();
    },
    [],
  );
  function closeDialog() {
    request.current?.abort();
    request.current = null;
    setPending(false);
    setError(null);
    setOpen(false);
    trigger.current?.focus();
  }
  function dismiss() {
    closeDialog();
    result.current?.close();
    result.current = null;
    setEntry(null);
  }
  function edit() {
    setError(null);
    setOpen(true);
  }
  async function run(query: SearchInput) {
    if (request.current) return;
    const token = new AbortController();
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
        return;
      }
      if (!settings) {
        setError(text.readError);
        return;
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
      setEntry({ query, result: session, policyKey });
      setOpen(false);
      void session.select(query.kind);
    } catch (cause) {
      if (token.signal.aborted) return;
      const failure = workspaceFailure(cause, source);
      if (failure === "session" || failure === "unauthorized")
        sessionIssue(failure);
      else setError(source === "storage" ? text.saveError : text.readError);
    } finally {
      if (request.current === token) {
        request.current = null;
        setPending(false);
      }
    }
  }
  const initial = entry?.query ?? {
    terms: "",
    scope: team,
    kind: "posts" as const,
  };
  return {
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
    dialog: open && (
      <Suspense fallback={null}>
        <SearchDialog
          account={connection}
          team={team}
          initial={initial}
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
