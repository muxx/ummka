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

test.each(["flush", "refresh", "submit"] as const)(
  "keeps the user's reverted text when SQLite committed a write whose reply was lost (%s)",
  async (operation) => {
    vi.useFakeTimers();
    const initial = { message: "original", revision: "r1" };
    const persisted = { message: "changed", revision: "r2" };
    const store = storage(initial);
    const editor = await openDraftEditor(store, channel);
    store.saveDraft.mockImplementationOnce(async () => {
      store.readDraft.mockResolvedValue(persisted);
      throw new Error("lost acknowledgement");
    });
    editor.edit("changed");
    await expect(editor.flush()).rejects.toThrow("lost acknowledgement");
    editor.edit(initial.message);
    expect(editor.getSnapshot().error).toBeInstanceOf(Error);
    store.saveDraft.mockResolvedValueOnce({
      kind: "conflict",
      draft: persisted,
    });
    await editor[operation]();
    expect(editor.getSnapshot()).toMatchObject({
      message: "original",
      stored: persisted,
      error: null,
      conflict: true,
    });
    expect(store.submitDraft).not.toHaveBeenCalled();
    if (operation !== "refresh")
      expect(store.saveDraft).toHaveBeenLastCalledWith({
        ...channel,
        expectedRevision: "r1",
        message: "original",
      });
  },
);

test.each(["edit to match", "choose device"] as const)(
  "reconciles the shown device version after a failed keep (%s)",
  async (choice) => {
    vi.useFakeTimers();
    const device = { message: "on device", revision: "other" };
    const ourWrite = { message: "our version", revision: "written" };
    const store = storage();
    const editor = await openDraftEditor(store, channel);
    editor.edit(ourWrite.message);
    store.readDraft.mockResolvedValueOnce(device);
    await editor.refresh();
    store.saveDraft.mockImplementationOnce(async () => {
      store.readDraft.mockResolvedValue(ourWrite);
      throw new Error("uncertain write");
    });
    await expect(editor.keepLocal(device.revision)).rejects.toThrow(
      "uncertain write",
    );
    if (choice === "edit to match") {
      editor.edit(device.message);
      store.saveDraft.mockResolvedValueOnce({
        kind: "conflict",
        draft: ourWrite,
      });
      await editor.retryStorage();
      expect(store.saveDraft).toHaveBeenLastCalledWith({
        ...channel,
        expectedRevision: device.revision,
        message: device.message,
      });
    } else {
      await editor.takeStored(device.revision);
      expect(store.saveDraft).toHaveBeenCalledTimes(1);
    }
    expect(editor.getSnapshot()).toMatchObject({
      message: device.message,
      stored: ourWrite,
      conflict: true,
      error: null,
    });
    expect(store.submitDraft).not.toHaveBeenCalled();
  },
);

test("after a failed write and read, a successful read restarts autosave for dirty text", async () => {
  vi.useFakeTimers();
  const store = storage({ message: "base", revision: "base-revision" });
  const editor = await openDraftEditor(store, channel);
  editor.edit("my edit");
  store.saveDraft.mockRejectedValueOnce("storage");
  await expect(editor.flush()).rejects.toBe("storage");
  store.readDraft.mockRejectedValueOnce("reading");
  await expect(editor.refresh()).rejects.toBe("reading");
  await editor.retryStorage();
  expect(store.saveDraft).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(600);
  expect(editor.getSnapshot()).toMatchObject({
    message: "my edit",
    stored: { message: "my edit" },
    error: null,
  });
});

test.each(["unchanged", "written elsewhere"])(
  "retries a failed write after editing back to the original text (%s)",
  async (disk) => {
    vi.useFakeTimers();
    const initial = { message: "original", revision: "r1" };
    const store = storage(initial);
    const editor = await openDraftEditor(store, channel);
    let rejectWrite!: (error: Error) => void;
    store.saveDraft.mockImplementationOnce(
      () =>
        new Promise<DraftSave>((_, reject) => {
          rejectWrite = reject;
        }),
    );
    editor.edit("changed");
    const writing = editor.flush();
    editor.edit(initial.message);
    rejectWrite(new Error("device write failed"));
    await expect(writing).rejects.toThrow("device write failed");
    const same = disk === "unchanged";
    const stored = same ? initial : { message: disk, revision: "r2" };
    store.saveDraft.mockResolvedValueOnce({
      kind: same ? "saved" : "conflict",
      draft: stored,
    });
    await editor.retryStorage();
    expect(store.saveDraft).toHaveBeenCalledTimes(2);
    expect(store.saveDraft).toHaveBeenLastCalledWith({
      ...channel,
      expectedRevision: "r1",
      message: "original",
    });
    expect(editor.getSnapshot()).toMatchObject({
      message: "original",
      stored,
      error: null,
      conflict: !same,
    });
    expect(store.submitDraft).not.toHaveBeenCalled();
  },
);

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

test.each(["saved", "failed"] as const)(
  "preserves a later edit made while the accepted draft is being saved (%s)",
  async (outcome) => {
    vi.useFakeTimers();
    const device = { message: "on this device", revision: "device" };
    const store = storage();
    const editor = await openDraftEditor(store, channel);
    editor.edit("mine");
    store.readDraft.mockResolvedValueOnce(device);
    await editor.refresh();
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    store.saveDraft.mockImplementationOnce(async () => {
      await gate;
      if (outcome === "failed") throw Error("write failed");
      return {
        kind: "saved",
        draft: { message: "mine", revision: "committed" },
      };
    });
    const keep = editor.keepLocal(device.revision);
    editor.edit(device.message);
    editor.edit("further input");
    finish();
    if (outcome === "saved") {
      await keep;
      await vi.runAllTimersAsync();
      expect(store.saveDraft).toHaveBeenLastCalledWith({
        ...channel,
        message: "further input",
        expectedRevision: "committed",
      });
    } else {
      await expect(keep).rejects.toThrow("write failed");
      expect(editor.getSnapshot()).toMatchObject({
        message: "further input",
        stored: device,
        conflict: true,
      });
      await vi.runAllTimersAsync();
      expect(store.saveDraft).toHaveBeenCalledTimes(1);
    }
  },
);

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

test.each(["takeStored", "keepLocal"] as const)(
  "waits for a pending device read before acting on the shown revision (%s)",
  async (choice) => {
    vi.useFakeTimers();
    const store = storage();
    const editor = await openDraftEditor(store, channel);
    editor.edit("still typing here");
    const shown = { message: "shown", revision: "r2" };
    const newer = { message: "", revision: "r3", clearedBySubmission: true };
    store.readDraft.mockResolvedValueOnce(shown);
    await editor.refresh();
    let finishRead!: (draft: ComposerDraft) => void;
    store.readDraft.mockReturnValueOnce(
      new Promise<ComposerDraft>((resolve) => {
        finishRead = resolve;
      }),
    );
    const checking = editor.refresh();
    const decision = editor[choice](shown.revision);
    finishRead(newer);
    await Promise.all([checking, decision]);
    expect(editor.getSnapshot()).toMatchObject({
      message: "still typing here",
      stored: newer,
      conflict: true,
      error: null,
    });
    expect(store.saveDraft).not.toHaveBeenCalled();
    expect(store.submitDraft).not.toHaveBeenCalled();
  },
);

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
