import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { availableDirectoryCopy } from "./available-directory-copy.ts";
import { DirectoryChannelIcon } from "./DirectoryChannelIcon.tsx";
import {
  type DirectoryChannel,
  DirectoryJoinDialog,
} from "./DirectoryJoinDialog.tsx";
import { DirectorySearch, directoryCopy } from "./DirectorySurface.tsx";
import {
  availableDirectoryChannels,
  openChannelDirectoryList,
} from "./open-channel-directory.ts";
import { openDirectorySearch } from "./open-directory-search.ts";
import { PanelRetry, PanelState } from "./PanelState.tsx";
import type { DirectoryProps } from "./TeamChannelDirectory.tsx";
import { workspaceCopy } from "./workspace-copy.ts";

const empty = () => null;
const noSubscription = () => () => {};
type Model = {
  list: ReturnType<typeof openChannelDirectoryList>;
  search: ReturnType<typeof openDirectorySearch>;
};

export function AvailableChannels({
  account,
  teamId,
  language,
  state,
  online,
  choose,
  refresh,
  sessionIssue,
  active,
}: DirectoryProps & { active: boolean }) {
  const text = availableDirectoryCopy[language],
    common = workspaceCopy[language],
    id = useId();
  const [accessLost, setAccessLost] = useState(false);
  const [model, setModel] = useState<Model | null>(null),
    [input, setInput] = useState("");
  const [selected, setSelected] = useState<DirectoryChannel | null>(null);
  const region = useRef<HTMLElement>(null),
    filter = useRef<HTMLInputElement>(null),
    edge = useRef<HTMLButtonElement>(null),
    opener = useRef<HTMLButtonElement | null>(null);
  const retryRows = useRef<Set<string> | null>(null);
  useEffect(() => {
    const next = {
      list: openChannelDirectoryList(account, teamId, "public"),
      search: openDirectorySearch(account, teamId),
    };
    setModel(next);
    return () => {
      next.search.close();
      next.list.close();
    };
  }, [account, teamId]);
  const page = useSyncExternalStore(
    model?.list.subscribe ?? noSubscription,
    model?.list.getSnapshot ?? empty,
  );
  const search = useSyncExternalStore(
    model?.search.subscribe ?? noSubscription,
    model?.search.getSnapshot ?? empty,
  );
  const joined = useMemo(
    () => new Set(state.value?.data.channels.map((c) => c.id)),
    [state.value],
  );
  const rows = useMemo(
    () =>
      availableDirectoryChannels(
        (search?.query ? search.items : page?.items) ?? [],
        joined,
      ),
    [search?.query, search?.items, page?.items, joined],
  );
  const status = (search?.query ? search.status : page?.status) ?? "idle";
  const denied =
    accessLost ||
    [page?.status, search?.status].some(
      (s) => s === "forbidden" || s === "unauthorized" || s === "session",
    );
  useEffect(() => {
    for (const s of [page?.status, search?.status]) {
      if (s === "session" || s === "unauthorized") {
        sessionIssue(s);
        break;
      }
    }
    if (denied) {
      setAccessLost(true);
      setSelected(null);
      model?.search.close();
      model?.list.close();
    }
  }, [page?.status, search?.status, sessionIssue, denied, model]);
  useEffect(() => {
    if (!active) {
      setInput("");
      model?.search.setQuery("");
    } else if (online && state.value && !denied && page?.status === "idle")
      void model?.list.more();
  }, [active, online, model, state.value, denied, page?.status]);
  const browsing =
    active && online && !!state.value && !denied && !search?.query;
  useEffect(() => {
    const button = edge.current;
    if (
      !browsing ||
      !button ||
      !model ||
      page?.status !== "ready" ||
      !page.hasMore
    )
      return;
    let observing = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (observing && entry?.isIntersecting) void model.list.more();
      },
      { root: region.current?.parentElement, rootMargin: "0px 0px 100px" },
    );
    observer.observe(button);
    return () => {
      observing = false;
      observer.disconnect();
    };
  }, [browsing, model, page]);
  useLayoutEffect(() => {
    const before = retryRows.current;
    if (!before || !active || status === "loading") return;
    retryRows.current = null;
    const first = rows.find((row) => !before.has(row.id));
    const target =
      first &&
      region.current?.querySelector<HTMLButtonElement>(
        `[data-directory-id="${first.id}"]`,
      );
    (target || edge.current)?.focus({ preventScroll: true });
  }, [active, status, rows]);
  function close() {
    setSelected(null);
    queueMicrotask(() => {
      const target = opener.current?.isConnected
        ? opener.current
        : filter.current;
      target?.focus({ preventScroll: true });
    });
  }
  const failed = status === "network" || status === "storage";
  const tail = !!page?.hasMore && !search?.query && !denied;
  const hasResults = !search?.query && !!page?.items.length;
  function retryDirectory() {
    if (!search?.query) retryRows.current = new Set(rows.map((r) => r.id));
    void (search?.query ? model?.search.retry() : model?.list.retry());
  }
  return (
    <section
      ref={region}
      className="channel-directory directory-column"
      aria-label={text.available}
    >
      {state.value && !denied && (
        <DirectorySearch
          ref={filter}
          language={language}
          value={input}
          onChange={(event) => {
            const value = event.target.value;
            setInput(value);
            model?.search.setQuery(value.trim().replace(/^[@#]/, ""));
          }}
          disabled={!online || !model}
        />
      )}
      {!state.value ? (
        state.status === "offline" ? (
          <PanelState
            variant="offline"
            role="status"
            title={common.offlineEmpty}
            message={common.noCache}
          />
        ) : state.status === "network" || state.status === "storage" ? (
          <PanelState
            variant="error"
            role="alert"
            message={common[state.status]}
          />
        ) : (
          <PanelState
            variant="pending"
            role="status"
            message={common.loading}
          />
        )
      ) : denied ? (
        <PanelState variant="error" role="alert" message={common.forbidden} />
      ) : (
        <>
          {!online && !failed && (
            <PanelState
              variant={hasResults ? "stale" : "offline"}
              role="status"
              message={text.offline}
            />
          )}
          {!!rows.length && (
            <ul aria-label={text.available}>
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="directory-channel"
                    data-directory-id={row.id}
                    aria-label={row.displayName}
                    aria-describedby={row.purpose ? id + row.id : undefined}
                    onClick={(event) => {
                      opener.current = event.currentTarget;
                      setSelected(row);
                    }}
                  >
                    <DirectoryChannelIcon kind="public" />
                    <span className="directory-channel-info">
                      <strong>{row.displayName}</strong>
                      <span id={id + row.id}>
                        {row.purpose || directoryCopy[language].public}
                      </span>
                    </span>
                    <span className="directory-channel-meta">{text.join}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {status === "loading" &&
            (hasResults ? (
              <p role="status">{text.loading}</p>
            ) : (
              <PanelState
                variant="pending"
                role="status"
                message={search?.query ? text.search : text.loading}
              />
            ))}
          {failed &&
            (hasResults ? (
              <p role="alert">
                {status === "storage" ? common.storage : common.network}{" "}
                <button
                  type="button"
                  disabled={!online}
                  ref={edge}
                  onClick={retryDirectory}
                >
                  {common.retry}
                </button>
              </p>
            ) : (
              <PanelState
                variant={online ? "error" : "offline"}
                role="alert"
                title={
                  online
                    ? search?.query
                      ? text.searchFailed
                      : text.loadFailed
                    : common.offlineEmpty
                }
                message={
                  status === "storage"
                    ? common.storage
                    : online
                      ? common.network
                      : text.offline
                }
                action={
                  <PanelRetry
                    disabled={!online}
                    ref={edge}
                    onClick={retryDirectory}
                  >
                    {common.retry}
                  </PanelRetry>
                }
              />
            ))}
          {status === "ready" && !rows.length && !tail && (
            <PanelState
              variant="empty"
              role="status"
              title={
                search?.query ? directoryCopy[language].noMatches : text.none
              }
              message={
                search?.query
                  ? directoryCopy[language].changeQueryOrTab
                  : text.noneHint
              }
            />
          )}
          {status === "ready" && rows.length > 0 && !tail && !search?.query && (
            <p role="status">{text.end}</p>
          )}
          {tail && status === "ready" && (
            <button
              className="directory-more"
              type="button"
              ref={edge}
              disabled={!online}
              onClick={() => void model?.list.more()}
            >
              {text.more}
            </button>
          )}
          {selected && (
            <DirectoryJoinDialog
              {...{
                account,
                channel: selected,
                state,
                online,
                language,
                refresh,
                choose,
                close,
                sessionIssue,
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
