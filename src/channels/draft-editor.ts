import type {
  ComposerDraft,
  DraftLocation,
  openAccountRestConnection,
} from "../mattermost/native-rest.ts";

type DraftStorage = Pick<
  Awaited<ReturnType<typeof openAccountRestConnection>>,
  "readDraft" | "saveDraft"
>;

type EditorState = {
  message: string;
  stored: ComposerDraft;
  conflict: boolean;
  error: unknown;
};

/** One editor owns one channel or thread on a particular account connection. */
export async function openDraftEditor(
  storage: DraftStorage,
  location: DraftLocation,
) {
  const key = { ...location };
  const stored = await storage.readDraft(key);
  let state: EditorState = {
    message: stored.message,
    stored,
    conflict: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: { kind: "read" | "write"; done: Promise<void> } | undefined;

  function publish(next: EditorState) {
    state = next;
    for (const listener of listeners) listener();
  }

  function unschedule() {
    clearTimeout(timer);
    timer = undefined;
  }

  function start(kind: "read" | "write", operation: () => Promise<void>) {
    const done = operation().finally(() => {
      active = undefined;
    });
    active = { kind, done };
    return done;
  }

  async function saveCurrent() {
    const { message, stored } = state;
    try {
      const result = await storage.saveDraft({
        ...key,
        expectedRevision: stored.revision,
        message,
      });
      const conflict =
        result.kind === "conflict" && state.message !== result.draft.message;
      if (conflict) unschedule();
      // Typing may have continued while the device was writing this revision.
      publish({ ...state, stored: result.draft, conflict, error: null });
    } catch (error) {
      publish({ ...state, error });
      throw error;
    }
  }

  function flush(): Promise<void> {
    unschedule();
    // A failed foreground read cannot cancel a pending compare-and-save.
    if (active?.kind === "read") return active.done.then(flush, flush);
    if (active) return active.done.then(flush);
    if (state.conflict || state.message === state.stored.message)
      return Promise.resolve();
    return start("write", saveCurrent);
  }

  function edit(message: string) {
    if (message === state.message) return;
    unschedule();
    const matches = message === state.stored.message;
    const conflict = state.conflict && !matches;
    publish({
      ...state,
      message,
      conflict,
      error: matches ? null : state.error,
    });
    if (!conflict && (!matches || active?.kind === "write")) {
      // Observers receive storage errors in the snapshot, including a timer-driven write.
      timer = setTimeout(() => {
        void flush().catch(() => {});
      }, 600);
    }
  }

  function refresh(): Promise<void> {
    if (active?.kind === "read") return active.done;
    if (active) return active.done.then(refresh);
    return start("read", async () => {
      let latest: ComposerDraft;
      try {
        latest = await storage.readDraft(key);
      } catch (error) {
        publish({ ...state, error });
        throw error;
      }
      const clean = state.message === state.stored.message;
      if (latest.revision === state.stored.revision) {
        if (clean && state.error !== null) publish({ ...state, error: null });
        return;
      }
      unschedule();
      const conflict = !clean && latest.message !== state.message;
      publish({
        message: conflict ? state.message : latest.message,
        stored: latest,
        conflict,
        error: null,
      });
    });
  }

  function takeStored(seenRevision: string | null) {
    if (!state.conflict || state.stored.revision !== seenRevision) return;
    unschedule();
    publish({
      ...state,
      message: state.stored.message,
      conflict: false,
      error: null,
    });
  }

  function keepLocal(seenRevision: string | null): Promise<void> {
    if (active) return active.done.then(() => keepLocal(seenRevision));
    if (!state.conflict || state.stored.revision !== seenRevision)
      return Promise.resolve();
    publish({ ...state, conflict: false });
    return flush().catch((error: unknown) => {
      if (state.message !== state.stored.message) {
        unschedule();
        publish({ ...state, conflict: true });
      }
      throw error;
    });
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    edit,
    flush,
    refresh,
    takeStored,
    keepLocal,
  };
}
