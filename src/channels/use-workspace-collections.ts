import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type CollectionReading,
  type CollectionReadingPlace,
  collectionReadingPlace,
} from "./CollectionScroll.tsx";
import { openMentionList } from "./mention-list.ts";
import { openPostCollection, returnedPostRemoved } from "./post-collection.ts";
import type { measureTimeline } from "./timeline-viewport.ts";

type CollectionsAccount = Parameters<typeof openPostCollection>[0] &
  Parameters<typeof openMentionList>[0];
type Collection = ReturnType<typeof openPostCollection>;
type Remembered<Model> = { model: Model; place?: CollectionReadingPlace };
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
export type RowOrigin = RestoredRow & {
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
  const saved = useRef<Remembered<Collection> | null>(null);
  const pins = useRef(new Map<string, Remembered<Collection>>());
  const previousMentions = useRef<
    | (Remembered<ReturnType<typeof openMentionList>> & {
        archivedChannels: boolean;
      })
    | null
  >(null);
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
  const deniedChannels = useRef(new Set<string>());
  const remembered = !view
    ? null
    : view.kind === "all"
      ? saved.current
      : view.kind === "mentions"
        ? previousMentions.current
        : pins.current.get(view.channelId);
  const reading = useMemo<CollectionReading | undefined>(() => {
    if (!remembered || !view) return;
    let viewport: HTMLElement | null = null;
    return {
      place: remembered.place,
      anchor() {
        return viewport
          ? collectionReadingPlace(viewport).anchor?.id
          : remembered.place?.anchor?.id;
      },
      attach(pane) {
        viewport = pane;
        return () => {
          viewport = null;
          const snapshot = remembered.model.getSnapshot();
          remembered.place = (
            "value" in snapshot
              ? snapshot.value
              : snapshot.hasResponse
          )
            ? collectionReadingPlace(pane)
            : undefined;
          if (view.kind !== "pins" && owned.current !== view)
            remembered.model.retainReading(remembered.place?.anchor?.id);
        };
      },
    };
  }, [view, remembered]);
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
  useLayoutEffect(() => {
    if (
      remembered &&
      (failure === "forbidden" ||
        failure === "unauthorized" ||
        failure === "session")
    )
      remembered.place = undefined;
  }, [remembered, failure]);
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
    if (view.kind === "pins") {
      void view.model.refresh();
      return;
    }
    if (view.kind === "mentions" || !view.returnRow) {
      void view.model.revalidate(reading?.anchor());
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
  }, [view, online, reading]);
  useLayoutEffect(
    () => () => {
      activation.current?.controller.abort();
      owned.current = null;
      for (const { model } of pins.current.values()) model.close();
      pins.current.clear();
      saved.current?.model.close();
      previousMentions.current?.model.close();
      saved.current = null;
      previousMentions.current = null;
      deniedChannels.current.clear();
    },
    [],
  );
  const abort = useCallback(() => {
    activation.current?.controller.abort();
    activation.current = null;
  }, []);
  const close = useCallback(
    (focus = true) => {
      if (!owned.current) return;
      abort();
      const previous = owned.current;
      owned.current = null;
      previous.model.suspend();
      if (previous.kind === "all") closeSavedSurface();
      origin.current = null;
      setRestore(null);
      returnFocus.current = focus ? previous.opener : null;
      setView(null);
    },
    [abort, closeSavedSurface],
  );
  const retainPins = useCallback(
    (
      allowed: ReadonlySet<string> | undefined,
      deniedChannel: string | null,
    ) => {
      if (!allowed && !deniedChannel) return;
      for (const [channelId, entry] of pins.current) {
        if (channelId !== deniedChannel && (!allowed || allowed.has(channelId)))
          continue;
        pins.current.delete(channelId);
        entry.model.close();
        const active = owned.current;
        if (active?.kind === "pins" && active.channelId === channelId)
          close(false);
      }
    },
    [close],
  );
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
      saved.current ??= { model: openPostCollection(account, { kind: "all" }) };
      next = { ...owner, ...source, model: saved.current.model };
    } else {
      let remembered = pins.current.get(source.channelId);
      if (!remembered) {
        remembered = { model: openPostCollection(account, source) };
        pins.current.set(source.channelId, remembered);
      }
      next = { ...owner, ...source, model: remembered.model };
    }
    if (next.kind !== "pins") {
      for (const id of deniedChannels.current)
        next.model.setChannelDenied(id, true);
    }
    owned.current = next;
    if (source.kind === "all" && source.returnRow) setRestore(source.returnRow);
    setView(next);
  }
  const setChannelDenied = useCallback((id: string, denied: boolean) => {
    if (denied) deniedChannels.current.add(id);
    else if (!deniedChannels.current.delete(id)) return;
    saved.current?.model.setChannelDenied(id, denied);
    previousMentions.current?.model.setChannelDenied(id, denied);
  }, []);
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
    reading,
    retainPins,
    setChannelDenied,
    open: show,
    close,
    abort,
    activate,
    restore,
    restoreRow,
    origin,
  };
}
