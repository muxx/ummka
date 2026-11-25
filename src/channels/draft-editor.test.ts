import { afterEach, expect, test, vi } from "vitest";
import type { ComposerDraft, DraftSave } from "../mattermost/native-rest.ts";
import { openDraftEditor } from "./draft-editor.ts";

const channel = { channelId: "c".repeat(26) };
const empty = { message: "", revision: null };
function storage(initial: ComposerDraft = empty) {
  return {
    readDraft: vi.fn().mockResolvedValue(initial),
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
