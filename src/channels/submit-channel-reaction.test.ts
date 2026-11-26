import { expect, test, vi } from "vitest";
import type { LocalPost } from "../mattermost/local-history.ts";
import {
  type ReactionThread,
  submitChannelReaction,
} from "./submit-channel-reaction.ts";

const channelId = "c".repeat(26),
  userId = "u".repeat(26),
  postId = "p".repeat(26);
const request = { action: "add" as const, emoji: "eyes" };
function make() {
  const account = {
    readChannelWindow: vi.fn().mockResolvedValue({
      posts: [
        { id: "ignored", channelId, rootId: null, type: "system_join_channel" },
        { id: postId, channelId, rootId: null, type: "" },
      ],
    }),
    readPostReactions: vi.fn().mockResolvedValue([]),
    addOwnReaction: vi.fn().mockResolvedValue({}),
    removeOwnReaction: vi.fn().mockResolvedValue(undefined),
    saveDraft: vi.fn().mockResolvedValue({
      kind: "saved",
      draft: { message: "", revision: "cleared" },
    }),
  };
  const context = {
    account,
    channelId,
    userId,
    collapsedThreads: true,
    archived: false,
    add: "allowed" as const,
    remove: "allowed" as const,
    uniqueLimit: "50",
  };
  const draft = {
    location: { channelId },
    revision: "shown",
    isCurrent: vi.fn().mockReturnValue(true),
  };
  return { account, context, draft, signal: new AbortController().signal };
}
test("a reaction reads the latest window, targets the eligible post, and clears only the submitted revision", async () => {
  const { account, context, draft, signal } = make();
  expect(await submitChannelReaction(context, request, draft, signal)).toEqual({
    kind: "applied",
    action: "add",
  });
  expect(account.readChannelWindow).toHaveBeenCalledExactlyOnceWith({
    kind: "latest",
    channelId,
    collapsedThreads: true,
    limit: 60,
  });
  expect(account.addOwnReaction).toHaveBeenCalledExactlyOnceWith(
    postId,
    "eyes",
    signal,
  );
  expect(account.saveDraft).toHaveBeenCalledExactlyOnceWith({
    channelId,
    expectedRevision: "shown",
    message: "",
  });
});
test("the int64 limit only affects new names and a missing remove permission prevents removal", async () => {
  const { account, context, draft, signal } = make();
  context.uniqueLimit = "-9223372036854775808";
  expect(await submitChannelReaction(context, request, draft, signal)).toEqual({
    kind: "limitReached",
  });
  account.readPostReactions.mockResolvedValue([
    { postId, userId: "other", emojiName: "eyes" },
  ]);
  expect(await submitChannelReaction(context, request, draft, signal)).toEqual({
    kind: "applied",
    action: "add",
  });
  account.readPostReactions.mockResolvedValue([
    { postId, userId, emojiName: "eyes" },
  ]);
  expect(
    await submitChannelReaction(
      { ...context, remove: "denied" },
      { action: "remove", emoji: "eyes" },
      draft,
      signal,
    ),
  ).toEqual({ kind: "permissionDenied" });
  expect(account.removeOwnReaction).not.toHaveBeenCalled();
  expect(account.addOwnReaction).toHaveBeenCalledTimes(1);
});
test("edits while reading cancel the mutation, and an edit after acceptance keeps the new text", async () => {
  const { account, context, draft, signal } = make();
  account.readPostReactions.mockImplementationOnce(async () => {
    draft.isCurrent.mockReturnValue(false);
    return [];
  });
  expect(await submitChannelReaction(context, request, draft, signal)).toEqual({
    kind: "changed",
  });
  expect(account.addOwnReaction).not.toHaveBeenCalled();
  draft.isCurrent.mockReturnValue(true);
  account.addOwnReaction.mockImplementationOnce(async () => {
    draft.isCurrent.mockReturnValue(false);
    return {};
  });
  expect(await submitChannelReaction(context, request, draft, signal)).toEqual({
    kind: "applied",
    action: "add",
  });
  expect(account.saveDraft).not.toHaveBeenCalled();
});
test("a server rejection preserves the draft and a local write failure preserves the confirmed answer", async () => {
  const { account, context, draft, signal } = make();
  account.addOwnReaction.mockRejectedValueOnce(new Error("refused"));
  await expect(
    submitChannelReaction(context, request, draft, signal),
  ).rejects.toThrow("refused");
  expect(account.saveDraft).not.toHaveBeenCalled();
  account.saveDraft.mockRejectedValueOnce("history_storage_unavailable");
  expect(await submitChannelReaction(context, request, draft, signal)).toEqual({
    kind: "appliedWithDraftError",
    action: "add",
  });
});

test("an uncached channel and a confirmed empty end give different reasons to keep the draft", async () => {
  const { account, context, draft, signal } = make();
  account.readChannelWindow.mockResolvedValueOnce(null);
  expect(await submitChannelReaction(context, request, draft, signal)).toEqual({
    kind: "historyUnknown",
  });
  account.readChannelWindow.mockResolvedValueOnce({ posts: [] });
  expect(await submitChannelReaction(context, request, draft, signal)).toEqual({
    kind: "noTarget",
  });
  expect(account.readPostReactions).not.toHaveBeenCalled();
  expect(account.saveDraft).not.toHaveBeenCalled();
});

type ThreadState = ReturnType<ReactionThread["getSnapshot"]>;
const root: LocalPost = {
  id: "r".repeat(26),
  channelId,
  userId,
  rootId: null,
  type: "",
  createAt: 10,
  updateAt: 10,
  editAt: 0,
  isPinned: false,
  message: "root",
  messageSource: null,
  hashtags: "",
};
const earlier = { ...root, id: "a".repeat(26), rootId: root.id };
const later = { ...earlier, id: "b".repeat(26) };
const system = { ...earlier, id: "s".repeat(26), type: "system_join_channel" };

function inThread(update: Partial<ThreadState> = {}) {
  const { context, draft, account, signal } = make();
  const state: ThreadState = {
    root,
    replies: [earlier, later, system],
    up: { status: "end" },
    down: { status: "end" },
    ...update,
  };
  const thread = {
    getSnapshot: vi.fn<() => ThreadState>().mockReturnValue(state),
  };
  return {
    context: { ...context, thread },
    account,
    signal,
    thread,
    state,
    draft: { ...draft, location: { channelId, rootId: root.id } },
  };
}

test("chooses the newest eligible reply from a confirmed tail, even with an older gap, and clears only the thread draft", async () => {
  const { context, draft, account, signal } = inThread({
    up: { status: "ready" },
  });
  expect(await submitChannelReaction(context, request, draft, signal)).toEqual({
    kind: "applied",
    action: "add",
  });
  expect(account.addOwnReaction).toHaveBeenCalledExactlyOnceWith(
    later.id,
    "eyes",
    signal,
  );
  expect(account.saveDraft).toHaveBeenCalledExactlyOnceWith({
    ...draft.location,
    expectedRevision: draft.revision,
    message: "",
  });
  expect(account.readChannelWindow).not.toHaveBeenCalled();
});

test.each<[Partial<ThreadState>, string]>([
  [{ replies: [] }, "applied"],
  [{ replies: [system] }, "applied"],
  [{ replies: [system], up: { status: "ready" } }, "historyUnknown"],
  [
    { down: { status: "error", error: new Error("offline") } },
    "historyUnknown",
  ],
  [{ root: null }, "historyUnknown"],
  [{ up: { status: "inaccessible", since: 10 } }, "changed"],
  [{ replies: [], root: { ...root, type: "system_generic" } }, "noTarget"],
])(
  "only uses the root after examining every reply: %o",
  async (state, kind) => {
    const { context, draft, account, signal } = inThread(state);
    expect(
      (await submitChannelReaction(context, request, draft, signal)).kind,
    ).toBe(kind);
    if (kind === "applied")
      expect(account.addOwnReaction).toHaveBeenCalledExactlyOnceWith(
        root.id,
        "eyes",
        signal,
      );
    else {
      expect(account.readPostReactions).not.toHaveBeenCalled();
      expect(account.saveDraft).not.toHaveBeenCalled();
    }
    expect(account.readChannelWindow).not.toHaveBeenCalled();
  },
);

test("neither another thread in the same channel nor another channel can supply a target", async () => {
  const { context, draft, account, signal } = inThread();
  for (const location of [
    { channelId },
    { ...draft.location, rootId: later.id },
    { ...draft.location, channelId: "x".repeat(26) },
  ]) {
    expect(
      await submitChannelReaction(
        context,
        request,
        { ...draft, location },
        signal,
      ),
    ).toEqual({ kind: "changed" });
  }
  expect(
    await submitChannelReaction(
      { ...context, thread: undefined },
      request,
      draft,
      signal,
    ),
  ).toEqual({ kind: "changed" });
  expect(account.readChannelWindow).not.toHaveBeenCalled();
  expect(account.readPostReactions).not.toHaveBeenCalled();
  expect(account.saveDraft).not.toHaveBeenCalled();
});

test.each(["before", "after"] as const)(
  "closing the reader %s a confirmed mutation cannot clear another draft",
  async (phase) => {
    const { context, draft, account, signal, thread, state } = inThread();
    const close = () =>
      thread.getSnapshot.mockReturnValue({ ...state, root: null, replies: [] });
    if (phase === "before")
      account.readPostReactions.mockImplementation(async () => {
        close();
        return [];
      });
    else
      account.addOwnReaction.mockImplementation(async () => {
        close();
      });
    const result = await submitChannelReaction(context, request, draft, signal);
    expect(result.kind).toBe(phase === "before" ? "changed" : "applied");
    expect(account.addOwnReaction).toHaveBeenCalledTimes(
      phase === "before" ? 0 : 1,
    );
    expect(account.saveDraft).not.toHaveBeenCalled();
  },
);
