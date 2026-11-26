import { expect, test, vi } from "vitest";
import type {
  LocalChannelWindow,
  LocalPost,
} from "../mattermost/local-history.ts";
import { prepareFocusedConversation } from "./prepare-focused-conversation.ts";

const channelId = "c".repeat(26);
function row(id: string, rootId: string | null = null): LocalPost {
  return {
    channelId,
    id: id.repeat(26),
    rootId,
    createAt: 100,
    updateAt: 100,
    editAt: 0,
    userId: "u".repeat(26),
    message: id,
    messageSource: null,
    type: "",
    hashtags: "",
    isPinned: false,
  };
}
const root = row("r");
const reply = { ...row("p", root.id), createAt: 500, updateAt: 500 };
function stored(...posts: LocalPost[]): LocalChannelWindow {
  return {
    posts,
    newer: { kind: "more", postId: "n".repeat(26) },
    older: { kind: "unknown" },
    firstInaccessiblePostTime: 50,
  };
}
type Account = Parameters<typeof prepareFocusedConversation>[0];
function account() {
  return {
    readChannelWindow: vi.fn<Account["readChannelWindow"]>(),
    refreshChannelHistory: vi.fn<Account["refreshChannelHistory"]>(),
  };
}

test.each([
  [root, false, root],
  [root, true, root],
  [reply, false, reply],
  [reply, true, root],
] as const)(
  "prepares the exact cached target without another request %#",
  async (target, collapsedThreads, anchor) => {
    const native = account();
    const page = stored(row("z"), anchor, row("a"));
    native.readChannelWindow.mockResolvedValue(page);
    const result = await prepareFocusedConversation(
      native,
      target,
      collapsedThreads,
      new AbortController().signal,
    );
    expect(native.readChannelWindow).toHaveBeenCalledExactlyOnceWith({
      channelId,
      postId: anchor.id,
      collapsedThreads,
      kind: "around",
      newer: 30,
      older: 30,
    });
    expect(native.refreshChannelHistory).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "ready",
      page,
      anchorId: anchor.id,
      ...(target === reply && collapsedThreads && { focusedReply: reply }),
    });
    if (result.status === "ready") expect(result.page).toBe(page);
  },
);

test("a miss reads only the committed focused window, preserving ties, gaps and a distant reply", async () => {
  const native = account();
  const page = stored(row("a"), root, row("z"));
  native.readChannelWindow
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(page);
  native.refreshChannelHistory.mockResolvedValue({ kind: "applied" });
  const { signal } = new AbortController();
  const result = await prepareFocusedConversation(native, reply, true, signal);
  expect(native.refreshChannelHistory).toHaveBeenCalledExactlyOnceWith(
    {
      kind: "focused",
      channelId,
      collapsedThreads: true,
      postId: root.id,
      perPage: 30,
    },
    signal,
  );
  expect(native.readChannelWindow.mock.calls).toHaveLength(2);
  expect(native.readChannelWindow.mock.calls[1]).toEqual(
    native.readChannelWindow.mock.calls[0],
  );
  expect(result).toEqual({
    status: "ready",
    page,
    anchorId: root.id,
    focusedReply: reply,
  });
});

test.each([
  [{ kind: "superseded" }, { status: "superseded" }],
  [
    { kind: "inaccessible", firstInaccessiblePostTime: 200 },
    { status: "inaccessible", firstInaccessiblePostTime: 200 },
  ],
] as const)(
  "withholds an obsolete window after a %j write",
  async (write, result) => {
    const native = account();
    native.readChannelWindow
      .mockResolvedValueOnce(null)
      .mockResolvedValue(stored(root));
    native.refreshChannelHistory.mockResolvedValue(write);
    await expect(
      prepareFocusedConversation(
        native,
        reply,
        true,
        new AbortController().signal,
      ),
    ).resolves.toEqual(result);
    expect(native.readChannelWindow).toHaveBeenCalledTimes(1);
  },
);

test.each([
  null,
  stored(row("z")),
  stored({ ...root, channelId: "w".repeat(26) }),
])(
  "withholds the destination when the committed page lacks its scoped anchor %#",
  async (page) => {
    const native = account();
    native.readChannelWindow
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(page);
    native.refreshChannelHistory.mockResolvedValue({ kind: "applied" });
    await expect(
      prepareFocusedConversation(
        native,
        reply,
        true,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: "unavailable" });
    expect(native.readChannelWindow).toHaveBeenCalledTimes(2);
    expect(native.refreshChannelHistory).toHaveBeenCalledTimes(1);
  },
);

test.each(["before", "first read", "refresh", "second read"] as const)(
  "an abort during %s cannot publish or start another read",
  async (phase) => {
    const native = account();
    const controller = new AbortController();
    const reason = new Error("selected a different result");
    const abort = (step: typeof phase) => {
      if (phase === step) controller.abort(reason);
    };
    abort("before");
    native.readChannelWindow
      .mockImplementationOnce(async () => {
        abort("first read");
        return phase === "first read" ? stored(root) : null;
      })
      .mockImplementationOnce(async () => {
        abort("second read");
        return stored(root);
      });
    native.refreshChannelHistory.mockImplementation(async () => {
      abort("refresh");
      return { kind: "applied" };
    });
    await expect(
      prepareFocusedConversation(native, reply, true, controller.signal),
    ).rejects.toBe(reason);
    expect(native.readChannelWindow).toHaveBeenCalledTimes(
      phase === "before" ? 0 : phase === "second read" ? 2 : 1,
    );
    expect(native.refreshChannelHistory).toHaveBeenCalledTimes(
      phase === "refresh" || phase === "second read" ? 1 : 0,
    );
  },
);

test.each(["first read", "refresh", "second read"] as const)(
  "propagates loss of access during %s without publishing stored data",
  async (phase) => {
    const native = account();
    const denied =
      phase === "refresh"
        ? new Response(null, { status: 403 })
        : "session_unavailable";
    if (phase === "first read")
      native.readChannelWindow.mockRejectedValueOnce(denied);
    else native.readChannelWindow.mockResolvedValueOnce(null);
    if (phase === "second read")
      native.readChannelWindow.mockRejectedValueOnce(denied);
    native.readChannelWindow.mockResolvedValue(stored(root));
    if (phase === "refresh")
      native.refreshChannelHistory.mockRejectedValue(denied);
    else native.refreshChannelHistory.mockResolvedValue({ kind: "applied" });
    await expect(
      prepareFocusedConversation(
        native,
        reply,
        true,
        new AbortController().signal,
      ),
    ).rejects.toBe(denied);
    expect(native.readChannelWindow).toHaveBeenCalledTimes(
      phase === "second read" ? 2 : 1,
    );
    expect(native.refreshChannelHistory).toHaveBeenCalledTimes(
      phase === "first read" ? 0 : 1,
    );
  },
);
