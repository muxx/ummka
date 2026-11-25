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
  let writing: Promise<void> | undefined;

  function publish(next: EditorState) {
    state = next;
    for (const listener of listeners) listener();
  }

  function unschedule() {
    clearTimeout(timer);
    timer = undefined;
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
    if (writing) return writing.then(flush);
    if (state.conflict || state.message === state.stored.message)
      return Promise.resolve();
    writing = saveCurrent().finally(() => {
      writing = undefined;
    });
    return writing;
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
    if (!conflict && (!matches || writing)) {
      // Observers receive storage errors in the snapshot, including a timer-driven write.
      timer = setTimeout(() => {
        void flush().catch(() => {});
      }, 600);
    }
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
  };
}
