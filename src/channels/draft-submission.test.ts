import { afterEach, expect, test, vi } from "vitest";
import type { ComposerDraft } from "../mattermost/native-rest.ts";
import { openDraftEditor } from "./draft-editor.ts";

const location = { channelId: "c".repeat(26), rootId: "r".repeat(26) };
const empty = { message: "", revision: null };
const original = { message: "  First **message** 🐻‍❄️\n", revision: "first" };
const cleared = { message: "", revision: "sent", clearedBySubmission: true };
function fixture(initial: ComposerDraft = empty) {
  return {
    readDraft: vi.fn().mockResolvedValue(initial),
    saveDraft: vi.fn().mockImplementation(async ({ message }) => ({
      kind: "saved",
      draft: { message, revision: "saved" },
    })),
    submitDraft: vi.fn().mockResolvedValue({
      kind: "sending",
      draft: cleared,
      post: { pendingId: "one" },
      completion: new Promise(() => {}),
    }),
  };
}
afterEach(() => vi.useRealTimers());

test("submits exactly the displayed Markdown once before debounce and frees the thread before the server replies", async () => {
  vi.useFakeTimers();
  const account = fixture();
  const editor = await openDraftEditor(account, location);
  editor.edit(original.message);
  const result = editor.submit();
  expect(editor.getSnapshot().submitting).toBe(true);
  await expect(editor.submit()).resolves.toEqual({ kind: "unchanged" });
  await expect(result).resolves.toMatchObject({
    kind: "sending",
    post: { pendingId: "one" },
  });
  expect(account.saveDraft).toHaveBeenCalledExactlyOnceWith({
    ...location,
    expectedRevision: null,
    message: original.message,
  });
  expect(account.submitDraft).toHaveBeenCalledExactlyOnceWith({
    ...location,
    revision: "saved",
  });
  expect(editor.getSnapshot()).toMatchObject({
    message: "",
    stored: cleared,
    submitting: false,
  });
  editor.edit("Next reply");
  await vi.advanceTimersByTimeAsync(600);
  expect(account.saveDraft).toHaveBeenLastCalledWith({
    ...location,
    expectedRevision: "sent",
    message: "Next reply",
  });
  expect(account.submitDraft).toHaveBeenCalledTimes(1);
});

test("typing during the first save never submits the replacement text", async () => {
  vi.useFakeTimers();
  const account = fixture();
  let finish!: () => void;
  account.saveDraft.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = () => resolve({ kind: "saved", draft: original });
    }),
  );
  const editor = await openDraftEditor(account, location);
  editor.edit(original.message);
  const clicked = editor.submit();
  editor.edit("Changed before local submission");
  await vi.advanceTimersByTimeAsync(600);
  finish();
  await expect(clicked).resolves.toEqual({ kind: "unchanged" });
  await editor.flush();
  expect(account.submitDraft).not.toHaveBeenCalled();
  expect(editor.getSnapshot().stored.message).toBe(
    "Changed before local submission",
  );
});

test("typing during the local handoff saves the next text on the cleared revision", async () => {
  vi.useFakeTimers();
  const account = fixture(original);
  let finish!: () => void;
  account.submitDraft.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = () =>
        resolve({
          kind: "sending",
          post: {},
          draft: cleared,
          completion: Promise.resolve({ kind: "unconfirmed" }),
        });
    }),
  );
  const editor = await openDraftEditor(account, location);
  const sending = editor.submit();
  editor.edit("Second reply");
  await vi.advanceTimersByTimeAsync(600);
  expect(account.saveDraft).not.toHaveBeenCalled();
  finish();
  await sending;
  await editor.flush();
  expect(account.saveDraft).toHaveBeenCalledExactlyOnceWith({
    ...location,
    expectedRevision: cleared.revision,
    message: "Second reply",
  });
  expect(editor.getSnapshot()).toMatchObject({
    message: "Second reply",
    conflict: false,
  });
});

test("takes the other window's saved value after a lost handoff and preserves simultaneous typing", async () => {
  vi.useFakeTimers();
  const neighbor = { message: "From the other window", revision: "newer" };
  for (const typing of [false, true]) {
    const account = fixture(original);
    account.submitDraft.mockResolvedValueOnce({
      kind: "notStaged",
      draft: neighbor,
    });
    const editor = await openDraftEditor(account, location);
    const send = editor.submit();
    if (typing) editor.edit("Local changes");
    await expect(send).resolves.toMatchObject({ kind: "notStaged" });
    expect(editor.getSnapshot()).toMatchObject({
      message: typing ? "Local changes" : neighbor.message,
      stored: neighbor,
      conflict: typing,
    });
    if (typing)
      await expect(editor.submit()).resolves.toEqual({ kind: "unchanged" });
    await vi.runAllTimersAsync();
    expect(account.saveDraft).not.toHaveBeenCalled();
    expect(account.submitDraft).toHaveBeenCalledTimes(1);
  }
});

test("leaves a draft in place offline or after storage failure and ignores whitespace-only input", async () => {
  vi.useFakeTimers();
  const account = fixture();
  const editor = await openDraftEditor(account, location);
  editor.edit(" \n\t");
  await expect(editor.submit()).resolves.toEqual({ kind: "unchanged" });
  editor.edit(original.message);
  account.saveDraft.mockRejectedValueOnce("storage");
  await expect(editor.submit()).rejects.toBe("storage");
  expect(editor.getSnapshot()).toMatchObject({
    submitting: false,
    message: original.message,
    error: "storage",
  });
  expect(account.submitDraft).not.toHaveBeenCalled();
  account.submitDraft.mockResolvedValueOnce({ kind: "offline" });
  await expect(editor.submit()).resolves.toEqual({ kind: "offline" });
  expect(editor.getSnapshot()).toMatchObject({
    submitting: false,
    message: original.message,
    stored: { message: original.message },
  });
});
