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
import { channelDirectoryCopy } from "./JoinedChannelDirectory.tsx";
import {
  availableDirectoryChannels,
  openChannelDirectoryList,
} from "./open-channel-directory.ts";
import { openDirectorySearch } from "./open-directory-search.ts";
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
  return (
    <section
      ref={region}
      className="channel-directory"
      aria-label={text.available}
    >
      {state.value && !denied && (
        <input
          ref={filter}
          type="search"
          className="directory-filter"
          value={input}
          aria-label={text.find}
          placeholder={text.find}
          onChange={(event) => {
            const value = event.target.value;
            setInput(value);
            model?.search.setQuery(value.trim().replace(/^[@#]/, ""));
          }}
          disabled={!online || !model}
        />
      )}
      {!state.value ? (
        <p role="status">
          {state.status === "offline"
            ? common.noCache
            : state.status === "network" || state.status === "storage"
              ? common[state.status]
              : common.loading}
        </p>
      ) : denied ? (
        <p role="alert">{common.forbidden}</p>
      ) : (
        <>
          {!online && <p role="status">{text.offline}</p>}
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
                        {row.purpose || channelDirectoryCopy[language].public}
                      </span>
                    </span>
                    <span className="directory-channel-meta">{text.join}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {status === "loading" && (
            <p role="status">{search?.query ? text.search : text.loading}</p>
          )}
          {failed && (
            <p role="alert">
              {status === "storage" ? common.storage : common.network}{" "}
              <button
                type="button"
                disabled={!online}
                ref={edge}
                onClick={() => {
                  if (!search?.query)
                    retryRows.current = new Set(rows.map((r) => r.id));
                  void (search?.query
                    ? model?.search.retry()
                    : model?.list.retry());
                }}
              >
                {common.retry}
              </button>
            </p>
          )}
          {status === "ready" && !rows.length && !tail && (
            <p role="status">{search?.query ? text.empty : text.none}</p>
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
