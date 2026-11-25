import type {
  ComposerDraft,
  DraftLocation,
  openAccountRestConnection,
} from "../mattermost/native-rest.ts";

type DraftStorage = Pick<
  Awaited<ReturnType<typeof openAccountRestConnection>>,
  "readDraft" | "saveDraft" | "submitDraft"
>;

type EditorState = {
  message: string;
  stored: ComposerDraft;
  conflict: boolean;
  submitting: boolean;
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
    submitting: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active:
    | { kind: "read" | "write" | "submit"; done: Promise<unknown> }
    | undefined;

  function publish(next: EditorState) {
    state = next;
    for (const listener of listeners) listener();
  }

  function unschedule() {
    clearTimeout(timer);
    timer = undefined;
  }

  function start<T>(
    kind: "read" | "write" | "submit",
    operation: () => Promise<T>,
  ) {
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
    // A different device operation cannot cancel a queued compare-and-save.
    if (active && active.kind !== "write")
      return active.done.then(flush, flush);
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
    if (!conflict && (!matches || (active && active.kind !== "read"))) {
      // Observers receive storage errors in the snapshot, including a timer-driven write.
      timer = setTimeout(() => {
        void flush().catch(() => {});
      }, 600);
    }
  }

  function refresh(): Promise<void> {
    if (active?.kind === "read") return active.done.then(() => {});
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
        ...state,
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

  async function submit() {
    const intended = state.message;
    const unchanged = { kind: "unchanged" } as const;
    if (state.submitting || state.conflict || !intended.trim())
      return unchanged;
    unschedule();
    publish({ ...state, submitting: true });
    try {
      // Use the same queue as autosave and focus refresh until SQLite finishes the handoff.
      // The separate HTTP completion never holds this queue.
      while (active) {
        const pending = active;
        if (pending.kind === "read") await pending.done.catch(() => {});
        else await pending.done;
      }
      if (state.conflict || state.message !== intended) return unchanged;
      return await start("submit", async () => {
        if (state.stored.message !== intended) await saveCurrent();
        const revision = state.stored.revision;
        if (
          state.conflict ||
          state.message !== intended ||
          state.stored.message !== intended ||
          revision === null
        )
          return unchanged;
        const result = await storage.submitDraft({ ...key, revision });
        if (result.kind === "offline") return result;
        const typed = state.message !== intended;
        const conflict =
          result.kind === "notStaged" &&
          typed &&
          state.message !== result.draft.message;
        if (conflict || !typed) unschedule();
        publish({
          ...state,
          message: typed ? state.message : result.draft.message,
          stored: result.draft,
          conflict,
          error: null,
        });
        return result;
      });
    } catch (error) {
      publish({ ...state, error });
      throw error;
    } finally {
      publish({ ...state, submitting: false });
    }
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
    submit,
    flush,
    refresh,
    takeStored,
    keepLocal,
  };
}
