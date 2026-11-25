import type { DraftLocation } from "../mattermost/native-rest.ts";
import { openDraftEditor } from "./draft-editor.ts";

type Storage = Parameters<typeof openDraftEditor>[0];
export type VisibleDraft = Awaited<ReturnType<typeof openDraftEditor>>;
type Entry = { opened: Promise<VisibleDraft>; readers: number };
// A returning pane must see the text that a departing pane is still saving.
const byConnection = new WeakMap<Storage, Map<string, Entry>>();

export function openVisibleDraft(connection: Storage, location: DraftLocation) {
  const key = JSON.stringify([location.channelId, location.rootId ?? null]);
  let drafts = byConnection.get(connection);
  if (!drafts) {
    drafts = new Map();
    byConnection.set(connection, drafts);
  }
  const previous = drafts.get(key);
  const entry = previous ?? {
    opened: openDraftEditor(connection, location),
    readers: 0,
  };
  entry.readers++;
  drafts.set(key, entry);
  const owned = drafts;
  function forget() {
    if (owned.get(key) === entry) owned.delete(key);
  }
  if (!previous) void entry.opened.catch(forget);
  return {
    opened: entry.opened,
    reused: Boolean(previous),
    close() {
      entry.readers--;
      if (entry.readers) return;
      void entry.opened
        .then(async (editor) => {
          await editor.flush();
          const state = editor.getSnapshot();
          if (
            !entry.readers &&
            !state.conflict &&
            state.message === state.stored.message
          )
            forget();
        })
        .catch(() => {
          // A failed write remains available for a retry in this account window.
        });
    },
  };
}
