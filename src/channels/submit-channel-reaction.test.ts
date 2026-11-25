import { expect, test, vi } from "vitest";
import { submitChannelReaction } from "./submit-channel-reaction.ts";

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
  const draft = { revision: "shown", isCurrent: vi.fn().mockReturnValue(true) };
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
