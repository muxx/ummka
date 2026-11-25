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
  let editGeneration = 0;
  const listeners = new Set<() => void>();
  // An IPC failure can hide a committed SQLite write. Only a subsequent device result settles it.
  let writeUnconfirmed = false;
  let lastFailure: "read" | "write" | { keep: string | null } = "read";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active:
    | { kind: "read" | "write" | "submit"; done: Promise<unknown> }
    | undefined;

  function publish(next: EditorState) {
    if (next.message !== state.message || (next.conflict && !state.conflict))
      editGeneration++;
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
      writeUnconfirmed = false;
      const conflict =
        result.kind === "conflict" && state.message !== result.draft.message;
      if (conflict) unschedule();
      // Typing may have continued while the device was writing this revision.
      publish({ ...state, stored: result.draft, conflict, error: null });
    } catch (error) {
      writeUnconfirmed = true;
      lastFailure = "write";
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
    if (
      state.conflict ||
      (state.message === state.stored.message && !writeUnconfirmed)
    )
      return Promise.resolve();
    return start("write", saveCurrent);
  }

  function scheduleSave() {
    timer = setTimeout(() => {
      void flush().catch(() => {});
    }, 600);
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
      error: matches && !writeUnconfirmed ? null : state.error,
    });
    if (
      !conflict &&
      (!matches || writeUnconfirmed || (active && active.kind !== "read"))
    ) {
      scheduleSave();
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
        lastFailure = "read";
        publish({ ...state, error });
        throw error;
      }
      const sameText = state.message === state.stored.message;
      const clean = sameText && !writeUnconfirmed;
      writeUnconfirmed = false;
      if (latest.revision === state.stored.revision) {
        if (
          (state.conflict && sameText) ||
          (state.error !== null && (sameText || lastFailure === "read"))
        ) {
          publish({
            ...state,
            conflict: state.conflict && !sameText,
            error: null,
          });
          if (!sameText && !state.conflict && timer === undefined)
            scheduleSave();
        }
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

  async function takeStored(seenRevision: string | null): Promise<void> {
    if (active) {
      await active.done;
      return takeStored(seenRevision);
    }
    if (!state.conflict || state.stored.revision !== seenRevision) return;
    unschedule();
    publish({
      ...state,
      message: state.stored.message,
      // An unacknowledged write may have changed the revision shown by this choice.
      conflict: writeUnconfirmed,
      error: null,
    });
    if (writeUnconfirmed) return refresh();
  }

  // The native staging transaction checks the revision again if another window has written.
  async function prepareSubmission(signal?: AbortSignal) {
    const { message, stored } = state;
    const generation = editGeneration;
    if (
      signal?.aborted ||
      state.submitting ||
      state.conflict ||
      !message.trim()
    )
      return null;
    await flush();
    const revision = state.stored.revision;
    const isCurrent = () =>
      !signal?.aborted &&
      !state.conflict &&
      editGeneration === generation &&
      state.message === message &&
      state.stored.message === message &&
      state.stored.revision === revision;
    if (
      revision === null ||
      (message === stored.message && revision !== stored.revision) ||
      state.submitting ||
      !isCurrent()
    )
      return null;
    return {
      message,
      revision,
      isCurrent,
      submitPost: () => submit(isCurrent),
    };
  }

  async function submit(isCurrent?: () => boolean) {
    const intended = state.message;
    const unchanged = { kind: "unchanged" } as const;
    if (
      state.submitting ||
      state.conflict ||
      !intended.trim() ||
      isCurrent?.() === false
    )
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
      if (
        state.conflict ||
        state.message !== intended ||
        isCurrent?.() === false
      )
        return unchanged;
      return await start("submit", async () => {
        if (writeUnconfirmed || state.stored.message !== intended)
          await saveCurrent();
        const revision = state.stored.revision;
        if (
          state.conflict ||
          state.message !== intended ||
          state.stored.message !== intended ||
          revision === null ||
          isCurrent?.() === false
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
      // A device retry may save or reread the text. Only a new submit action can send it.
      lastFailure = state.message === state.stored.message ? "read" : "write";
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
    unschedule();
    // Keep the conflict and its actions visible until the device confirms the accepted revision.
    return start("write", saveCurrent).then(
      () => {
        if (
          !state.conflict &&
          state.message !== state.stored.message &&
          timer === undefined
        )
          scheduleSave();
      },
      (error: unknown) => {
        if (state.message !== state.stored.message) {
          unschedule();
          lastFailure = { keep: seenRevision };
          if (!state.conflict) publish({ ...state, conflict: true });
        }
        throw error;
      },
    );
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
    submit: () => submit(),
    prepareSubmission,
    flush,
    refresh,
    takeStored,
    keepLocal,
    retryStorage() {
      if (state.error === null) return Promise.resolve();
      if (lastFailure === "read") return refresh();
      if (typeof lastFailure === "object" && state.conflict)
        return keepLocal(lastFailure.keep);
      return flush();
    },
  };
}
