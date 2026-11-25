import { afterEach, expect, test, vi } from "vitest";
import type { ComposerDraft, DraftSave } from "../mattermost/native-rest.ts";
import { openDraftEditor } from "./draft-editor.ts";

const channel = { channelId: "c".repeat(26) };
const empty = { message: "", revision: null };
function storage(initial: ComposerDraft = empty) {
  return {
    readDraft: vi.fn().mockResolvedValue(initial),
    submitDraft: vi.fn(),
    saveDraft: vi
      .fn()
      .mockImplementation(async ({ message }: { message: string }) => ({
        kind: "saved",
        draft: { message, revision: "next" },
      })),
  };
}
afterEach(() => vi.useRealTimers());

test("reads the stored draft before displaying it and batches offline typing", async () => {
  vi.useFakeTimers();
  const saved = { message: "  First line\n", revision: "first" };
  const store = storage(saved);
  const editor = await openDraftEditor(store, channel);
  expect(editor.getSnapshot().message).toBe(saved.message);
  const changed = vi.fn();
  const stop = editor.subscribe(changed);
  editor.edit("second");
  await vi.advanceTimersByTimeAsync(599);
  editor.edit("  second line\n🐻‍❄️");
  await vi.advanceTimersByTimeAsync(599);
  expect(store.saveDraft).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(store.saveDraft).toHaveBeenCalledExactlyOnceWith({
    ...channel,
    expectedRevision: "first",
    message: "  second line\n🐻‍❄️",
  });
  expect(editor.getSnapshot().stored.message).toBe("  second line\n🐻‍❄️");
  stop();
  await editor.flush();
  expect(changed).toHaveBeenCalledTimes(3);
});

test("serializes blur and a later edit including reverting to the initial text during a save", async () => {
  vi.useFakeTimers();
  const store = storage();
  let finish!: (result: DraftSave) => void;
  const pending = new Promise<DraftSave>((resolve) => {
    finish = resolve;
  });
  store.saveDraft.mockReturnValueOnce(pending);
  const editor = await openDraftEditor(store, channel);
  editor.edit("first");
  const first = editor.flush();
  editor.edit("");
  const last = editor.flush();
  expect(store.saveDraft).toHaveBeenCalledTimes(1);
  finish({
    kind: "saved",
    draft: { message: "first", revision: "first-saved" },
  });
  await Promise.all([first, last]);
  expect(store.saveDraft.mock.calls[1]).toEqual([
    { ...channel, expectedRevision: "first-saved", message: "" },
  ]);
  expect(editor.getSnapshot().message).toBe("");
  await vi.runAllTimersAsync();
  expect(store.saveDraft).toHaveBeenCalledTimes(2);
});

test("keeps both versions and pauses automatic writes after a conflict", async () => {
  vi.useFakeTimers();
  const store = storage();
  const remote = { message: "another window", revision: "second" };
  store.saveDraft.mockResolvedValueOnce({ kind: "conflict", draft: remote });
  const editor = await openDraftEditor(store, channel);
  editor.edit("in this field");
  await editor.flush();
  editor.edit("still typing");
  expect(editor.getSnapshot()).toMatchObject({
    message: "still typing",
    stored: remote,
    conflict: true,
  });
  await editor.flush();
  await vi.runAllTimersAsync();
  expect(store.saveDraft).toHaveBeenCalledTimes(1);
  editor.edit(remote.message);
  expect(editor.getSnapshot().conflict).toBe(false);
  expect(store.saveDraft).toHaveBeenCalledTimes(1);
});

test("retains the text after an error and retries on the same account and thread", async () => {
  vi.useFakeTimers();
  const thread = { ...channel, rootId: "r".repeat(26) };
  const store = storage();
  store.saveDraft.mockRejectedValueOnce("storage");
  const reply = await openDraftEditor(store, thread);
  const room = await openDraftEditor(store, channel);
  reply.edit("kept");
  await vi.advanceTimersByTimeAsync(600);
  expect(reply.getSnapshot()).toMatchObject({
    message: "kept",
    stored: empty,
    error: "storage",
  });
  expect(room.getSnapshot().message).toBe("");
  await vi.advanceTimersByTimeAsync(5000);
  expect(store.saveDraft).toHaveBeenCalledTimes(1);
  await reply.flush();
  expect(store.saveDraft).toHaveBeenLastCalledWith({
    ...thread,
    expectedRevision: null,
    message: "kept",
  });
  expect(reply.getSnapshot().error).toBeNull();
  store.readDraft.mockRejectedValueOnce("unknown_connection");
  await expect(openDraftEditor(store, channel)).rejects.toBe(
    "unknown_connection",
  );
});

test("refresh adopts an external edit or empty revision in a clean editor without writing", async () => {
  const store = storage({ message: "old", revision: "1" });
  const editor = await openDraftEditor(store, channel);
  const changed = { message: "updated", revision: "2" };
  store.readDraft.mockResolvedValueOnce(changed);
  await editor.refresh();
  expect(editor.getSnapshot()).toMatchObject({
    message: "updated",
    stored: changed,
    conflict: false,
  });
  const sent = { message: "", revision: "3", clearedBySubmission: true };
  store.readDraft.mockResolvedValueOnce(sent);
  await editor.refresh();
  expect(editor.getSnapshot()).toMatchObject({
    message: "",
    stored: sent,
    conflict: false,
  });
  expect(store.saveDraft).not.toHaveBeenCalled();
});

test("typing during a refresh retains the input, coalesces reads and pauses autosave", async () => {
  vi.useFakeTimers();
  const store = storage();
  const editor = await openDraftEditor(store, channel);
  let received!: (draft: ComposerDraft) => void;
  store.readDraft.mockReturnValueOnce(
    new Promise<ComposerDraft>((resolve) => {
      received = resolve;
    }),
  );
  const active = editor.refresh();
  const repeated = editor.refresh();
  editor.edit("local");
  const flush = editor.flush();
  received({ message: "device", revision: "another" });
  await Promise.all([active, repeated, flush]);
  expect(store.readDraft).toHaveBeenCalledTimes(2);
  expect(editor.getSnapshot()).toMatchObject({
    message: "local",
    stored: { message: "device" },
    conflict: true,
  });
  editor.takeStored("unseen");
  expect(editor.getSnapshot().message).toBe("local");
  editor.takeStored("another");
  expect(editor.getSnapshot()).toMatchObject({
    message: "device",
    conflict: false,
  });
  await vi.runAllTimersAsync();
  expect(store.saveDraft).not.toHaveBeenCalled();
});

test("completes a pending autosave even if refreshing the stored revision fails", async () => {
  vi.useFakeTimers();
  const store = storage();
  const editor = await openDraftEditor(store, channel);
  let fail!: (error: string) => void;
  store.readDraft.mockReturnValueOnce(
    new Promise<ComposerDraft>((_, reject) => {
      fail = reject;
    }),
  );
  const refresh = expect(editor.refresh()).rejects.toBe("storage");
  editor.edit("must survive");
  await vi.advanceTimersByTimeAsync(600);
  expect(store.saveDraft).not.toHaveBeenCalled();
  fail("storage");
  await refresh;
  await vi.runAllTimersAsync();
  expect(store.saveDraft).toHaveBeenCalledExactlyOnceWith({
    ...channel,
    expectedRevision: null,
    message: "must survive",
  });
  expect(editor.getSnapshot()).toMatchObject({
    stored: { message: "must survive" },
    conflict: false,
    error: null,
  });
});

test("keeping local checks the version shown and preserves a third window's newer edit", async () => {
  vi.useFakeTimers();
  const store = storage();
  const editor = await openDraftEditor(store, channel);
  editor.edit("ours");
  store.readDraft.mockResolvedValueOnce({ message: "second", revision: "2" });
  await editor.refresh();
  store.readDraft.mockResolvedValueOnce({ message: "third", revision: "3" });
  const reloading = editor.refresh();
  const staleChoice = editor.keepLocal("2");
  await Promise.all([reloading, staleChoice]);
  expect(store.saveDraft).not.toHaveBeenCalled();
  const next = { message: "fourth", revision: "4" };
  store.saveDraft.mockResolvedValueOnce({ kind: "conflict", draft: next });
  await editor.keepLocal("3");
  expect(store.saveDraft).toHaveBeenCalledWith({
    ...channel,
    message: "ours",
    expectedRevision: "3",
  });
  expect(editor.getSnapshot()).toMatchObject({
    message: "ours",
    stored: next,
    conflict: true,
  });
  store.saveDraft.mockRejectedValueOnce("storage");
  await expect(editor.keepLocal("4")).rejects.toBe("storage");
  expect(editor.getSnapshot().conflict).toBe(true);
  await editor.keepLocal("4");
  expect(editor.getSnapshot()).toMatchObject({
    message: "ours",
    stored: { message: "ours" },
    conflict: false,
    error: null,
  });
});

test("recognizes the same edit in two windows without an extra write", async () => {
  vi.useFakeTimers();
  const store = storage();
  const editor = await openDraftEditor(store, channel);
  editor.edit("same");
  store.readDraft.mockResolvedValueOnce({ message: "same", revision: "2" });
  await editor.refresh();
  await vi.runAllTimersAsync();
  expect(store.saveDraft).not.toHaveBeenCalled();
  expect(editor.getSnapshot()).toMatchObject({
    message: "same",
    stored: { revision: "2" },
    conflict: false,
  });
});
