import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { openMentionList } from "./mention-list.ts";
import { openPostCollection, returnedPostRemoved } from "./post-collection.ts";
import type { measureTimeline } from "./timeline-viewport.ts";

type CollectionsAccount = Parameters<typeof openPostCollection>[0] &
  Parameters<typeof openMentionList>[0];
type RestoredRow = {
  id: string;
  scroll: number;
  offset?: number;
  index?: number;
};
type Source =
  | { kind: "all"; returnRow?: RestoredRow }
  | { kind: "pins"; channelId: string };
type Mentions = {
  kind: "mentions";
  archivedChannels: boolean;
  standalone: boolean;
};
type View = { key: number; opener: HTMLButtonElement } & (
  | (Source & { model: ReturnType<typeof openPostCollection> })
  | (Mentions & { model: ReturnType<typeof openMentionList> })
);
type RowOrigin = RestoredRow & {
  channelId: string | null;
  ids: readonly string[];
  partial: boolean;
  reading: ReturnType<typeof measureTimeline> | null;
};
const subscribeToNothing = () => () => {};
const empty = () => null;

export function useWorkspaceCollections(
  account: CollectionsAccount,
  online: boolean,
  archivedChannels: boolean | undefined,
  sessionIssue: (issue: "session" | "unauthorized") => void,
  closeSavedSurface: () => void,
) {
  const generation = useRef(0);
  const [view, setView] = useState<View | null>(null);
  const owned = useRef(view);
  const saved = useRef<ReturnType<typeof openPostCollection> | null>(null);
  const previousMentions = useRef<{
    archivedChannels: boolean;
    model: ReturnType<typeof openMentionList>;
  } | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (view || !returnFocus.current) return;
    const button = returnFocus.current;
    returnFocus.current = null;
    if (button.isConnected) button.focus();
  }, [view]);
  const activation = useRef<{ id: string; controller: AbortController } | null>(
    null,
  );
  const origin = useRef<RowOrigin | null>(null);
  const [restore, setRestore] = useState<RestoredRow | null>(null);
  const collection = view?.kind === "mentions" ? null : view;
  const mentions = view?.kind === "mentions" ? view : null;
  const state = useSyncExternalStore(
    collection?.model.subscribe ?? subscribeToNothing,
    collection?.model.getSnapshot ?? empty,
  );
  const mentionState = useSyncExternalStore(
    mentions?.model.subscribe ?? subscribeToNothing,
    mentions?.model.getSnapshot ?? empty,
  );
  const failure = state?.status ?? mentionState?.status;
  const reported = useRef<View | null>(null);
  useEffect(() => {
    if (
      view &&
      view === owned.current &&
      view !== reported.current &&
      (failure === "session" || failure === "unauthorized") &&
      view.model.getSnapshot().status === failure
    ) {
      reported.current = view;
      sessionIssue(failure);
    }
  }, [view, failure, sessionIssue]);
  useLayoutEffect(() => {
    if (!online) {
      activation.current?.controller.abort();
      activation.current = null;
    }
  }, [online]);
  useEffect(() => {
    if (!view || !online) return;
    if (view.kind !== "all" || !view.returnRow) {
      void view.model.refresh();
      return;
    }
    const { model, returnRow } = view;
    const stop = model.subscribe(() => {
      if (owned.current !== view) return;
      const snapshot = model.getSnapshot();
      if (snapshot.status !== "ready") return;
      if (
        snapshot.value?.items.some(({ id }) => id === returnRow.id) ||
        returnedPostRemoved(snapshot, returnRow.id, returnRow.index) ||
        snapshot.continuation === "none"
      ) {
        stop();
      } else if (snapshot.continuation === "available") {
        void model.loadMore();
      }
    });
    void model.refresh(returnRow.id);
    return stop;
  }, [view, online]);
  useLayoutEffect(
    () => () => {
      activation.current?.controller.abort();
      const previous = owned.current;
      owned.current = null;
      if (previous?.kind === "pins") previous.model.close();
      saved.current?.close();
      previousMentions.current?.model.close();
      saved.current = null;
      previousMentions.current = null;
    },
    [],
  );
  function abort() {
    activation.current?.controller.abort();
    activation.current = null;
  }
  function close(focus = true) {
    if (!owned.current) return;
    abort();
    const previous = owned.current;
    owned.current = null;
    if (previous.kind === "pins") previous.model.close();
    else previous.model.suspend();
    if (previous.kind === "all") closeSavedSurface();
    origin.current = null;
    setRestore(null);
    returnFocus.current = focus ? previous.opener : null;
    setView(null);
  }
  useLayoutEffect(() => {
    const remembered = previousMentions.current;
    if (!remembered || remembered.archivedChannels === archivedChannels) return;
    if (owned.current?.kind === "mentions") close();
    remembered.model.close();
    previousMentions.current = null;
  });
  function show(source: Source | Mentions, opener: HTMLButtonElement) {
    close(false);
    returnFocus.current = null;
    const owner = { key: ++generation.current, opener };
    let next: View;
    if (source.kind === "mentions") {
      previousMentions.current ??= {
        archivedChannels: source.archivedChannels,
        model: openMentionList(account, source.archivedChannels),
      };
      next = { ...owner, ...source, model: previousMentions.current.model };
    } else if (source.kind === "all") {
      saved.current ??= openPostCollection(account, { kind: "all" });
      next = { ...owner, ...source, model: saved.current };
    } else {
      next = {
        ...owner,
        ...source,
        model: openPostCollection(account, source),
      };
    }
    owned.current = next;
    if (source.kind === "all" && source.returnRow) setRestore(source.returnRow);
    setView(next);
  }
  async function activate(
    id: string,
    open: (signal: AbortSignal) => Promise<void>,
  ) {
    if (activation.current?.id === id) return;
    abort();
    const request = new AbortController();
    activation.current = { id, controller: request };
    try {
      await open(request.signal);
    } finally {
      if (activation.current?.controller === request) activation.current = null;
    }
  }
  function restoreRow(id: string) {
    if (!origin.current) return null;
    const row = { ...origin.current, id };
    setRestore(row);
    origin.current = null;
    return row;
  }
  return {
    view,
    state,
    mentionState,
    open: show,
    close,
    abort,
    activate,
    restore,
    restoreRow,
    origin,
  };
}
