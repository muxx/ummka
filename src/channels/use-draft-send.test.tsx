import { act, cleanup, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { openDraftEditor } from "./draft-editor.ts";
import { type DraftSendContext, useDraftSend } from "./use-draft-send.ts";

afterEach(cleanup);
async function fixture(message: string) {
  const original = { message, revision: "one" };
  const storage = {
    readDraft: vi.fn().mockResolvedValue(original),
    saveDraft: vi.fn().mockImplementation(async ({ message }) => ({
      kind: "saved",
      draft: { message, revision: "next" },
    })),
    submitDraft: vi
      .fn()
      .mockResolvedValue({ kind: "notStaged", draft: original }),
  };
  const editor = await openDraftEditor(storage, { channelId: "c".repeat(26) });
  const account = {
    readChannelMemberCount: vi.fn().mockResolvedValue(12),
    readChannelTimezoneCount: vi.fn().mockResolvedValue(2),
    readAssociatedMentionGroups: vi.fn(),
    searchMentionGroups: vi.fn(),
    readMentionGroupCounts: vi.fn(),
  };
  const ctx: DraftSendContext = {
    post: {
      account,
      channel: { id: "c".repeat(26) },
      team: null,
      settings: {
        maxNotificationsPerChannel: "100",
        confirmNotifications: true,
        ldapGroups: false,
        customGroups: false,
      },
      channelPermission: "allowed",
      groupPermission: "denied",
    },
    route: vi.fn().mockResolvedValue({ kind: "post" }),
    performOther: vi.fn(),
    resolveAttempt: vi.fn(),
  };
  const report = vi.fn();
  const sessionIssue = vi.fn();
  const field = createRef<HTMLTextAreaElement>();
  const hook = renderHook(
    ({ online }) =>
      useDraftSend(editor, ctx, online, field, sessionIssue, report),
    { initialProps: { online: true } },
  );
  return { ctx, storage, editor, report, ...hook };
}
test("one accepted warning submits exactly the draft that raised it", async () => {
  const { result, storage, report } = await fixture("@here lunch");
  await act(() => result.current.begin());
  expect(result.current.confirmation).toMatchObject({
    kind: "here",
    members: 11,
  });
  expect(storage.submitDraft).not.toHaveBeenCalled();
  await act(async () => {
    await Promise.all([result.current.confirm(), result.current.confirm()]);
  });
  expect(storage.submitDraft).toHaveBeenCalledExactlyOnceWith({
    channelId: "c".repeat(26),
    revision: "one",
  });
  expect(result.current.confirmation).toBeNull();
  expect(report).not.toHaveBeenCalled();
});
test("a local edit, an offline event, or cancellation invalidates an offered warning", async () => {
  for (const reason of ["edited", "offline", "cancel"]) {
    const { editor, result, storage, rerender, unmount } =
      await fixture("@all release");
    await act(() => result.current.begin());
    const confirm = result.current.confirm;
    act(() => {
      if (reason === "edited") editor.edit("updated");
      if (reason === "offline") rerender({ online: false });
      if (reason === "cancel") result.current.back();
    });
    await act(() => confirm());
    expect(result.current.confirmation).toBeNull();
    expect(storage.submitDraft).not.toHaveBeenCalled();
    unmount();
    await editor.flush();
  }
});
test("ordinary text sends immediately and slash commands never enter outgoing messages", async () => {
  const plain = await fixture("no mention");
  await act(() => plain.result.current.begin());
  expect(plain.storage.submitDraft).toHaveBeenCalledOnce();
  expect(plain.ctx.post.account.readChannelMemberCount).not.toHaveBeenCalled();
  const command = await fixture("/me @all");
  vi.mocked(command.ctx.route).mockResolvedValue({ kind: "command" });
  await act(() => command.result.current.begin());
  expect(command.ctx.performOther).toHaveBeenCalledOnce();
  expect(command.storage.submitDraft).not.toHaveBeenCalled();
  expect(
    command.ctx.post.account.readChannelMemberCount,
  ).not.toHaveBeenCalled();
});
