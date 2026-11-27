import {
  FetchError,
  type Preference,
  ResponseError,
} from "../../vendor/mattermost/index.js";
import { assertAccountPreference, isMattermostId } from "./model-fields.ts";

export type SavedPostMembership = {
  readonly ids: ReadonlySet<string>;
  readonly upperBound: number;
};

export function projectSavedPostMembership(
  userId: string,
  rows: readonly Preference[] | null | undefined,
): SavedPostMembership {
  const ids = new Set<string>();
  let upperBound = 0;
  for (const row of rows ?? []) {
    assertAccountPreference(row, userId);
    if (row.category !== "flagged_post") continue;
    upperBound++;
    if (isMattermostId(row.name)) ids.add(row.name);
  }
  return { ids, upperBound };
}

export type SavedPostState = ReturnType<typeof createSavedPostState>;

type ReadFailure = "read-failed" | "read-refused";
type SavedPostPresentation =
  | ReadFailure
  | "loading"
  | "unconfirmed"
  | "saved"
  | "unsaved"
  | "saving"
  | "removing";

function readFailure(error: unknown): ReadFailure {
  const cause =
    error instanceof Error &&
    (error.cause instanceof ResponseError || error.cause instanceof FetchError)
      ? error.cause
      : error;
  if (cause instanceof ResponseError) {
    const { status } = cause.response;
    return status === 401 || status === 403 || status === 404
      ? "read-refused"
      : "read-failed";
  }
  const native = cause instanceof FetchError ? cause.cause.cause : cause;
  return native === "operation_denied" ||
    native === "session_unavailable" ||
    native === "outside_installation" ||
    native === "cleartext_denied"
    ? "read-refused"
    : "read-failed";
}

class SavedPostWritePending extends Error {
  override name = "SavedPostWritePending";
}

export function createSavedPostState() {
  const listeners = new Set<() => void>();
  const writeListeners = new Set<(postId: string, saved: boolean) => void>();
  const pending = new Map<string, { saved: boolean; result: Promise<void> }>();
  const reads = new Set<number>();
  const writes = new Map<
    string,
    { order: number; saved: boolean | undefined }
  >();
  let order = 0;
  let accepted = 0;
  let membership: SavedPostMembership | undefined;
  let failure: { order: number; reason: ReadFailure } | undefined;
  let closed = false;

  function get(postId: string) {
    const write = writes.get(postId);
    return write ? write.saved : membership?.ids.has(postId);
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  function finishRead(read: number, error?: unknown) {
    if (!reads.delete(read)) return;
    if (error !== undefined && read > Math.max(accepted, failure?.order ?? 0))
      failure = { order: read, reason: readFailure(error) };
    notify();
  }

  return {
    get,
    getPresentation(postId: string): SavedPostPresentation {
      const write = pending.get(postId);
      if (write) return write.saved ? "saving" : "removing";
      const saved = get(postId);
      if (saved !== undefined) return saved ? "saved" : "unsaved";
      if (writes.has(postId)) return "unconfirmed";
      const settled = Math.max(accepted, failure?.order ?? 0);
      for (const read of reads) if (read > settled) return "loading";
      return failure?.reason ?? "loading";
    },
    getUpperBound() {
      if (!membership) return undefined;
      let upperBound = membership.upperBound;
      for (const [id, write] of writes)
        if (write.saved && !membership.ids.has(id)) upperBound++;
      return upperBound;
    },
    isPending: (postId: string) => pending.has(postId),
    subscribe(listener: () => void) {
      if (!closed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeToWrites(listener: (postId: string, saved: boolean) => void) {
      if (!closed) writeListeners.add(listener);
      return () => {
        writeListeners.delete(listener);
      };
    },
    beginRead() {
      const read = ++order;
      if (!closed) {
        reads.add(read);
        notify();
      }
      return read;
    },
    finishRead,
    publish(read: number, result: SavedPostMembership) {
      if (reads.has(read) && read > accepted) {
        accepted = read;
        if (failure && failure.order <= read) failure = undefined;
        // The caller of readSavedPostPreferences also receives the projected Set.
        membership = {
          ids: new Set(result.ids),
          upperBound: result.upperBound,
        };
        // A read in flight cannot overwrite a write that settled during the read.
        for (const [postId, write] of writes)
          if (write.order < read) writes.delete(postId);
      }
      finishRead(read);
    },
    runWrite(postId: string, saved: boolean, perform: () => Promise<void>) {
      const existing = pending.get(postId);
      if (existing)
        return existing.saved === saved
          ? existing.result
          : Promise.reject(
              new SavedPostWritePending("A saved post change is in flight."),
            );
      const result = Promise.resolve()
        .then(() => {
          if (closed) throw "cancelled";
          return perform();
        })
        .finally(() => {
          if (pending.delete(postId)) notify();
        });
      pending.set(postId, { saved, result });
      notify();
      return result;
    },
    record(postId: string, saved: boolean | undefined) {
      if (closed) return;
      const previous = get(postId);
      writes.set(postId, { order: ++order, saved });
      if (saved !== undefined)
        for (const listener of writeListeners) listener(postId, saved);
      if (previous !== saved) notify();
    },
    close() {
      closed = true;
      membership = undefined;
      failure = undefined;
      reads.clear();
      pending.clear();
      writes.clear();
      listeners.clear();
      writeListeners.clear();
    },
  };
}
