import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { PendingPost } from "../mattermost/account-delivery.ts";
import type { LocalChannelWindow } from "../mattermost/local-history.ts";
import { outgoingRowState } from "../mattermost/outgoing-row-state.ts";
import { ConversationTimeline } from "./ConversationTimeline.tsx";
import {
  conversationRows,
  type OutgoingPlacement,
} from "./conversation-rows.ts";
import { outgoingDescription } from "./outgoing-copy.ts";
import { useConversationOutgoing } from "./use-conversation-outgoing.tsx";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { channelPageSize } from "./workspace-data.ts";

import "./workspace-dom.test-utils.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function pending(n: number, extra: Partial<PendingPost> = {}): PendingPost {
  return {
    sequence: n,
    pendingId: "pending-" + n,
    channelId: "general",
    rootId: null,
    message: "same",
    createdAt: n,
    previousLogin: false,
    confirmedPostId: null,
    files: [],
    attempt: 1,
    refusal: null,
    ...extra,
  };
}
function server(
  id: string,
  time: number,
  extra: Partial<LocalChannelWindow["posts"][number]> = {},
): LocalChannelWindow["posts"][number] {
  return {
    id,
    channelId: "general",
    rootId: null,
    userId: "me",
    type: "",
    message: "same",
    messageSource: null,
    hashtags: "",
    isPinned: false,
    createAt: time,
    updateAt: time,
    editAt: 0,
    ...extra,
  };
}
const end = { kind: "end" } as const;
function page(...posts: LocalChannelWindow["posts"]): LocalChannelWindow {
  return { posts, older: end, newer: end, firstInaccessiblePostTime: 0 };
}
function account(rows: PendingPost[], online = false) {
  let listener = () => {};
  const saved = [...rows];
  const connection = {
    rid: 1,
    readPendingPosts: vi.fn(
      async ({
        channelId,
        rootId,
        before,
        limit,
      }: {
        channelId: string;
        rootId?: string;
        before?: number | string;
        limit: number;
      }) =>
        saved
          .filter(
            (p) =>
              p.channelId === channelId &&
              p.rootId === (rootId ?? null) &&
              (before === undefined || BigInt(p.sequence) < BigInt(before)),
          )
          .slice(0, limit),
    ),
    resendPost: vi
      .fn<WorkspaceConnection["resendPost"]>()
      .mockResolvedValue({ kind: "unavailable" }),
    dismissPendingPost: vi.fn(
      async (key: { pendingId: string; attempt: number }) => {
        const index = saved.findIndex(
          (p) =>
            p.pendingId === key.pendingId &&
            p.attempt === key.attempt &&
            p.confirmedPostId === null,
        );
        if (index < 0) return false;
        saved.splice(index, 1);
        return true;
      },
    ),
    retireDeliveredPosts: vi.fn(async (ids: string[]) => {
      const removed = saved.filter(
        (p) => p.confirmedPostId && ids.includes(p.confirmedPostId),
      );
      for (const row of removed) saved.splice(saved.indexOf(row), 1);
      return removed.length;
    }),
    subscribeToPostActivity: vi.fn(
      (
        _where: { channelId: string; rootId?: string | null },
        callback: () => void,
      ) => {
        listener = callback;
        return () => {
          listener = () => {};
        };
      },
    ),
    getOutgoingPostState: (post: PendingPost) =>
      outgoingRowState(post, false, online),
  };
  return { connection, changed: () => listener(), saved };
}
const view = {
  channelId: "general",
  userId: "me",
  locale: "en" as const,
  offline: true,
  latest: true,
  page: null as LocalChannelWindow | null,
  author: () => undefined,
  sessionIssue: vi.fn(),
};

test("uses the secondary role only while the first page is pending", async () => {
  const { connection } = account([]);
  const props = { ...view, connection, offline: false };
  const { rerender } = render(
    <ConversationTimeline {...props} waitingMessage="Loading messages…" />,
  );
  expect(
    screen
      .getByText("Loading messages…")
      .classList.contains("panel-text--secondary"),
  ).toBe(true);
  rerender(<ConversationTimeline {...props} page={page()} />);
  expect(
    screen
      .getByText("There are no messages in this channel yet.")
      .classList.contains("panel-text--secondary"),
  ).toBe(false);
  await act(async () => {});
});

test("preserves both tie orders and matches only a confirmed post of the same author, room and root", () => {
  const records = [
    pending(5, { confirmedPostId: "reply" }),
    pending(4, { confirmedPostId: "peer" }),
    pending(3, { confirmedPostId: "confirmed" }),
    pending(2, { createdAt: 1 }),
    pending(1),
    pending(0, { channelId: "wrong" }),
  ];
  const history = [
    server("reply", 8, { rootId: "root" }),
    server("peer", 8, { userId: "someone" }),
    server("confirmed", 7),
    server("tie-first", 1),
    server("tie-second", 1),
  ];
  const shown = conversationRows(
    history,
    records,
    "general",
    null,
    "me",
    "timeline",
  );
  expect(shown.messages.map((p) => p.id)).toEqual([
    "tie-second",
    "tie-first",
    "pending-1",
    "pending-2",
    "pending-4",
    "pending-5",
    "confirmed",
    "peer",
    "reply",
  ]);
  expect(shown.matched).toEqual(["confirmed"]);
  expect(shown.messages.find((p) => p.id === "confirmed")?.localId).toBe(
    "pending-3",
  );
  expect(
    conversationRows(
      history,
      records,
      "general",
      null,
      "me",
      "hidden",
    ).messages.map((p) => p.id),
  ).toEqual(history.map((p) => p.id).reverse());
  const sameText = conversationRows(
    [server("different", 1)],
    [pending(1)],
    "general",
    null,
    "me",
    "timeline",
  );
  expect(sameText.messages.map((p) => p.id)).toEqual([
    "different",
    "pending-1",
  ]);
});

test("opens the bounded tail and reads an earlier page only on request", async () => {
  const { connection } = account(
    Array.from({ length: channelPageSize + 1 }, (_, i) =>
      pending(channelPageSize + 1 - i, {
        message: "attempt " + (channelPageSize + 1 - i),
      }),
    ),
  );
  render(<ConversationTimeline {...view} connection={connection} />);
  await screen.findByText("attempt " + (channelPageSize + 1));
  expect(screen.queryByText("attempt 1")).toBeNull();
  expect(connection.readPendingPosts).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Show earlier outgoing messages" }),
  );
  await screen.findByText("attempt 1");
  expect(connection.readPendingPosts).toHaveBeenLastCalledWith({
    channelId: "general",
    rootId: undefined,
    before: 2,
    limit: channelPageSize + 1,
  });
  expect(
    screen.queryByRole("button", { name: "Show earlier outgoing messages" }),
  ).toBeNull();
  expect(screen.queryByText("No history saved on this device yet.")).toBeNull();
});

test("restores native status, retires only a matched canonical post and ignores a late response from the previous room", async () => {
  const store = account([
    pending(3, { message: "**local copy**", confirmedPostId: "canonical" }),
    pending(2, { message: "still uncertain" }),
    pending(1, { channelId: "other", message: "other room" }),
  ]);
  let finish!: (value: PendingPost[]) => void;
  const active = render(
    <ConversationTimeline {...view} connection={store.connection} />,
  );
  const outgoing = (await screen.findByText("**local copy**")).closest(
    "article",
  );
  expect(outgoing?.querySelector(".published-post")).toBeNull();
  active.rerender(
    <ConversationTimeline
      {...view}
      connection={store.connection}
      page={page(
        server("canonical", 3, {
          message: "**server copy**",
          messageSource: "Original before formatting",
        }),
      )}
    />,
  );
  const delivered = await screen.findByText("server copy");
  expect(delivered.tagName).toBe("STRONG");
  expect(delivered.closest("article")).toBe(outgoing);
  expect(screen.queryByText("Original before formatting")).toBeNull();
  await waitFor(() =>
    expect(store.saved.some((p) => p.confirmedPostId === "canonical")).toBe(
      false,
    ),
  );
  expect(screen.queryByText("**local copy**")).toBeNull();
  expect(store.connection.retireDeliveredPosts).toHaveBeenCalledWith([
    "canonical",
  ]);
  store.connection.readPendingPosts.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => store.changed());
  active.rerender(
    <ConversationTimeline
      {...view}
      connection={store.connection}
      channelId="other"
    />,
  );
  expect(screen.queryByText("still uncertain")).toBeNull();
  await screen.findByText("other room");
  await act(async () => finish([pending(2, { message: "stale result" })]));
  expect(screen.queryByText("stale result")).toBeNull();
  expect(store.connection.subscribeToPostActivity).toHaveBeenLastCalledWith(
    { channelId: "other", rootId: undefined },
    expect.any(Function),
  );
});

test("storage failure can be retried and loss of the session clears visible local text", async () => {
  const store = account([pending(1, { message: "restore me" })]);
  store.connection.readPendingPosts.mockRejectedValueOnce(
    "history_storage_unavailable",
  );
  const sessionIssue = vi.fn();
  render(
    <ConversationTimeline
      {...view}
      connection={store.connection}
      sessionIssue={sessionIssue}
    />,
  );
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("restore me");
  store.connection.readPendingPosts.mockRejectedValueOnce(
    "session_unavailable",
  );
  act(() => store.changed());
  await waitFor(() => expect(sessionIssue).toHaveBeenCalledWith("session"));
  expect(screen.queryByText("restore me")).toBeNull();
});

test("distinguishes an active send, a definite refusal, an uncertain retry and a previous sign-in", () => {
  const refusal = {
    status: 403,
    code: "api.context.permissions.app_error",
    message: "server diagnostic",
  };
  const label = (post: PendingPost, sending = false) =>
    outgoingDescription(outgoingRowState(post, sending, true), "ru");
  expect(label(pending(1), true)).toBe("Отправляется…");
  expect(label(pending(1, { refusal }))).toContain("Не отправлено");
  expect(label(pending(1, { retryRefusal: refusal }))).toContain(
    "Первая отправка могла дойти",
  );
  expect(label(pending(1, { previousLogin: true }))).toContain(
    "прежнему входу",
  );
  expect(label(pending(1, { confirmedPostId: "server" }))).toBe("");
});

test("copies the shown text including line breaks from an earlier login without network", async () => {
  const message = "first line\n**second** 🐻";
  const clipboard = {
    writeText: vi
      .fn()
      .mockRejectedValueOnce(new Error("system clipboard"))
      .mockResolvedValue(undefined),
  };
  vi.stubGlobal("navigator", { clipboard, onLine: false });
  const store = account([pending(7, { message, previousLogin: true })]);
  render(<ConversationTimeline {...view} connection={store.connection} />);
  const button = await screen.findByRole("button", { name: "Copy text" });
  fireEvent.click(button);
  await screen.findByText("Couldn’t copy the text.");
  fireEvent.click(button);
  await screen.findByText("Text copied.");
  expect(clipboard.writeText).toHaveBeenCalledWith(message);
  expect(store.connection.dismissPendingPost).not.toHaveBeenCalled();
  expect(store.saved).toHaveLength(1);
});

test("removes just the observed attempt, refreshes offline and returns keyboard focus to this timeline", async () => {
  const store = account([pending(8, { message: "local only" })]);
  render(<ConversationTimeline {...view} connection={store.connection} />);
  const button = await screen.findByRole("button", { name: "Remove" });
  button.focus();
  fireEvent.click(button);
  await screen.findByText("Message removed from this device.");
  await waitFor(() => expect(screen.queryByText("local only")).toBeNull());
  expect(store.connection.dismissPendingPost).toHaveBeenCalledExactlyOnceWith({
    pendingId: "pending-8",
    attempt: 1,
  });
  expect(document.activeElement).toBe(
    screen.getByRole("region", { name: "Channel messages" }),
  );
  expect(screen.queryByRole("button", { name: "Copy text" })).toBeNull();
});

test("reloads a newer attempt after a stale removal and leaves failed storage actionable", async () => {
  const store = account([pending(9, { message: "old row" })]);
  render(<ConversationTimeline {...view} connection={store.connection} />);
  const button = await screen.findByRole("button", { name: "Remove" });
  store.connection.dismissPendingPost.mockRejectedValueOnce(
    "history_storage_unavailable",
  );
  fireEvent.click(button);
  await screen.findByText("Couldn’t remove this message from the device.");
  store.saved[0] = {
    ...store.saved[0],
    attempt: 2,
    message: "changed elsewhere",
  };
  fireEvent.click(button);
  await screen.findByText("The outgoing message has changed.");
  await screen.findByText("changed elsewhere");
  expect(store.saved).toHaveLength(1);
  expect(store.connection.dismissPendingPost).toHaveBeenLastCalledWith({
    pendingId: "pending-9",
    attempt: 1,
  });
});

test("a late removal reply cannot announce or focus in a different conversation", async () => {
  const store = account([pending(10)]);
  let finish!: (removed: boolean) => void;
  store.connection.dismissPendingPost.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const current = render(
    <ConversationTimeline {...view} connection={store.connection} />,
  );
  const button = await screen.findByRole("button", { name: "Remove" });
  button.focus();
  fireEvent.click(button);
  fireEvent.click(button);
  current.rerender(
    <ConversationTimeline
      {...view}
      channelId="moved"
      connection={store.connection}
    />,
  );
  await act(async () => finish(true));
  expect(store.connection.dismissPendingPost).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Message removed from this device.")).toBeNull();
});

test("only an explicit second click retries the displayed attempt; cancellation restores focus", async () => {
  const store = account([pending(11)], true);
  render(
    <ConversationTimeline
      {...view}
      offline={false}
      connection={store.connection}
    />,
  );
  const repeat = () => screen.getByRole("button", { name: "Send again" });
  fireEvent.click(await screen.findByRole("button", { name: "Send again" }));
  const confirm = () => screen.getByRole("button", { name: "Send anyway" });
  expect(document.activeElement).toBe(confirm());
  expect(
    document.getElementById(confirm().getAttribute("aria-describedby") ?? "")
      ?.textContent,
  ).toMatch(/duplicate/);
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  fireEvent.keyDown(confirm(), { key: "Escape" });
  expect(document.activeElement).toBe(repeat());
  fireEvent.click(repeat());
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(repeat());
  expect(store.connection.resendPost).not.toHaveBeenCalled();
  fireEvent.click(repeat());
  const button = confirm();
  fireEvent.click(button);
  fireEvent.click(button);
  await screen.findByText("The outgoing message has changed.");
  expect(store.connection.resendPost).toHaveBeenCalledExactlyOnceWith(
    { pendingId: "pending-11", attempt: 1 },
    { kind: "despiteUnknownDelivery" },
  );
  expect(document.activeElement).toBe(repeat().closest("article"));
});

test("going offline during confirmation prevents dispatch; a replaced attempt needs fresh confirmation", async () => {
  const store = account([pending(12)], true);
  let online = true;
  store.connection.getOutgoingPostState = (post) =>
    outgoingRowState(post, false, online);
  render(<ConversationTimeline {...view} connection={store.connection} />);
  fireEvent.click(await screen.findByRole("button", { name: "Send again" }));
  online = false;
  act(() => store.changed());
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Send anyway" })
        .getAttribute("aria-disabled"),
    ).toBe("true"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send anyway" }));
  online = true;
  store.saved[0] = { ...store.saved[0], attempt: 2 };
  act(() => store.changed());
  await screen.findByRole("button", { name: "Send again" });
  expect(screen.queryByRole("button", { name: "Send anyway" })).toBeNull();
  expect(store.connection.resendPost).not.toHaveBeenCalled();
});

test("a late retry completion leaves the new conversation alone", async () => {
  const store = account([pending(13)], true);
  let finish!: () => void;
  store.connection.resendPost.mockResolvedValueOnce({
    kind: "sending",
    post: pending(13, { attempt: 2 }),
    completion: new Promise((resolve) => {
      finish = () => resolve({ kind: "unauthorized" });
    }),
  });
  const sessionIssue = vi.fn();
  const current = render(
    <ConversationTimeline
      {...view}
      connection={store.connection}
      sessionIssue={sessionIssue}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Send again" }));
  fireEvent.click(screen.getByRole("button", { name: "Send anyway" }));
  current.rerender(
    <ConversationTimeline
      {...view}
      channelId="moved"
      connection={store.connection}
      sessionIssue={sessionIssue}
    />,
  );
  await act(async () => finish());
  expect(sessionIssue).not.toHaveBeenCalled();
  expect(screen.queryByText("The outgoing message has changed.")).toBeNull();
});

test("keeps own thread attempts beyond the gap until their canonical rows are visible and stored", async () => {
  const rootId = "thread";
  const sending = pending(2, { rootId });
  const other = pending(3, { rootId });
  const unrelated = pending(1, { rootId: "other" });
  const store = account([other, sending, unrelated]);
  const persisted =
    store.connection.retireDeliveredPosts.getMockImplementation();
  if (!persisted) throw Error("Expected native receipt fixture");
  let stored = false;
  store.connection.retireDeliveredPosts.mockImplementation((ids) =>
    stored ? persisted(ids) : Promise.resolve(0),
  );
  const first = server("before", 1, { rootId });
  const confirmed = server("delivered", 2, { rootId });
  const props = {
    channelId: "general",
    rootId,
    connection: store.connection,
    userId: "me",
    history: [first],
    placement: "afterGap" as OutgoingPlacement,
    locale: "en" as const,
    sessionIssue: vi.fn(),
  };
  const hook = renderHook(useConversationOutgoing, { initialProps: props });
  const shown = () => ({
    timeline: hook.result.current.messages.map((p) => p.id),
    beyond: hook.result.current.afterGap.map((p) => p.id),
  });

  await waitFor(() =>
    expect(shown()).toEqual({
      timeline: ["before"],
      beyond: ["pending-2", "pending-3"],
    }),
  );
  expect(store.connection.subscribeToPostActivity).toHaveBeenCalledWith(
    { channelId: "general", rootId },
    expect.any(Function),
  );
  sending.confirmedPostId = confirmed.id;
  await act(async () => store.changed());
  expect(shown().beyond).toEqual(["pending-2", "pending-3"]);
  expect(store.connection.retireDeliveredPosts).not.toHaveBeenCalled();

  // A matching receipt alone does not identify another author's row.
  hook.rerender({
    ...props,
    history: [{ ...confirmed, userId: "peer" }, first],
  });
  expect(shown().beyond).toEqual(["pending-2", "pending-3"]);
  expect(store.connection.retireDeliveredPosts).not.toHaveBeenCalled();
  hook.rerender({ ...props, history: [confirmed, first] });
  await waitFor(() =>
    expect(store.connection.retireDeliveredPosts).toHaveBeenCalledWith([
      "delivered",
    ]),
  );
  expect(shown()).toEqual({
    timeline: ["before", "delivered"],
    beyond: ["pending-3"],
  });
  expect(hook.result.current.messages[1]?.localId).toBe("pending-2");
  expect(store.saved).toContain(sending);

  // Leaving the in-memory page before SQLite has the row restores the local copy.
  hook.rerender(props);
  expect(shown().beyond).toEqual(["pending-2", "pending-3"]);
  stored = true;
  hook.rerender({
    ...props,
    placement: "timeline",
    history: [confirmed, first],
  });
  await waitFor(() => expect(store.saved).not.toContain(sending));
  expect(shown()).toEqual({
    timeline: ["before", "delivered", "pending-3"],
    beyond: [],
  });
  expect(store.saved).toEqual([other, unrelated]);
});

test("disabling thread delivery hides attempts immediately, ignores an old read, and retains the selected canonical reply", async () => {
  const rootId = "room-thread";
  const record = pending(1, { rootId });
  const store = account([record]);
  const focus = server("focus", 5, { rootId });
  const props = {
    channelId: "general",
    rootId,
    connection: store.connection,
    userId: "me",
    history: [focus],
    placement: "afterGap" as const,
    locale: "en" as const,
    sessionIssue: vi.fn(),
    enabled: false,
  };
  const hook = renderHook(useConversationOutgoing, { initialProps: props });
  expect(hook.result.current.messages).toEqual([focus]);
  expect(store.connection.subscribeToPostActivity).not.toHaveBeenCalled();
  hook.rerender({ ...props, enabled: true });
  await waitFor(() => expect(hook.result.current.afterGap).toHaveLength(1));
  let finish!: (rows: PendingPost[]) => void;
  store.connection.readPendingPosts.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => store.changed());
  hook.rerender(props);
  expect(hook.result.current.messages).toEqual([focus]);
  expect(hook.result.current.afterGap).toHaveLength(0);
  await act(async () => finish([record]));
  expect(hook.result.current.afterGap).toHaveLength(0);
});
