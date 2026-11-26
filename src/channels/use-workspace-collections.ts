import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { openPostCollection } from "./post-collection.ts";

type CollectionsAccount = Parameters<typeof openPostCollection>[0];
type Source = { kind: "all" } | { kind: "pins"; channelId: string };
type RowOrigin = { id: string; channelId: string | null; scroll: number };
const subscribeToNothing = () => () => {};
const empty = () => null;

export function useWorkspaceCollections(
  account: CollectionsAccount,
  online: boolean,
) {
  const generation = useRef(0);
  const [view, setView] = useState<{
    key: number;
    source: Source;
    model: ReturnType<typeof openPostCollection>;
    opener: HTMLButtonElement;
  } | null>(null);
  const owned = useRef(view);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (view || !returnFocus.current) return;
    const button = returnFocus.current;
    returnFocus.current = null;
    if (button.isConnected) button.focus();
  }, [view]);
  const activation = useRef<AbortController | null>(null);
  const origin = useRef<RowOrigin | null>(null);
  const [restore, setRestore] = useState<RowOrigin | null>(null);
  const state = useSyncExternalStore(
    view?.model.subscribe ?? subscribeToNothing,
    view?.model.getSnapshot ?? empty,
  );
  useEffect(() => {
    if (view && online) void view.model.refresh();
  }, [view, online]);
  useEffect(
    () => () => {
      activation.current?.abort();
      owned.current?.model.close();
    },
    [],
  );
  function abort() {
    activation.current?.abort();
    activation.current = null;
  }
  function close(focus = true) {
    if (!owned.current) return;
    abort();
    const previous = owned.current;
    owned.current = null;
    previous.model.close();
    origin.current = null;
    setRestore(null);
    returnFocus.current = focus ? previous.opener : null;
    setView(null);
  }
  function show(source: Source, opener: HTMLButtonElement) {
    close(false);
    returnFocus.current = null;
    const next = {
      key: ++generation.current,
      source,
      opener,
      model: openPostCollection(account, source),
    };
    owned.current = next;
    setView(next);
  }
  async function activate(
    from: RowOrigin,
    open: (signal: AbortSignal) => Promise<void>,
  ) {
    if (activation.current && origin.current?.id === from.id) return;
    abort();
    const request = new AbortController();
    activation.current = request;
    origin.current = from;
    try {
      await open(request.signal);
    } finally {
      if (activation.current === request) activation.current = null;
    }
  }
  function restoreRow() {
    const row = origin.current;
    setRestore(row);
    origin.current = null;
    return row;
  }
  return {
    view,
    state,
    open: show,
    close,
    abort,
    activate,
    restore,
    restoreRow,
    origin,
  };
}
