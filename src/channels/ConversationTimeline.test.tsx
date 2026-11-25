import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { PendingPost } from "../mattermost/account-delivery.ts";
import type { LocalChannelWindow } from "../mattermost/local-history.ts";
import { outgoingRowState } from "../mattermost/outgoing-row-state.ts";
import { ConversationTimeline } from "./ConversationTimeline.tsx";
import { conversationRows } from "./conversation-rows.ts";
import { outgoingDescription } from "./outgoing-copy.ts";
import { channelPageSize } from "./workspace-data.ts";

afterEach(cleanup);
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
function account(rows: PendingPost[]) {
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
      outgoingRowState(post, false, false),
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
  const shown = conversationRows(history, records, "general", null, "me", true);
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
      false,
    ).messages.map((p) => p.id),
  ).toEqual(history.map((p) => p.id).reverse());
  const sameText = conversationRows(
    [server("different", 1)],
    [pending(1)],
    "general",
    null,
    "me",
    true,
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
    pending(3, { message: "local copy", confirmedPostId: "canonical" }),
    pending(2, { message: "still uncertain" }),
    pending(1, { channelId: "other", message: "other room" }),
  ]);
  let finish!: (value: PendingPost[]) => void;
  const active = render(
    <ConversationTimeline {...view} connection={store.connection} />,
  );
  await screen.findByText("local copy");
  active.rerender(
    <ConversationTimeline
      {...view}
      connection={store.connection}
      page={page(server("canonical", 3, { message: "server copy" }))}
    />,
  );
  await screen.findByText("server copy");
  await waitFor(() =>
    expect(store.saved.some((p) => p.confirmedPostId === "canonical")).toBe(
      false,
    ),
  );
  expect(screen.queryByText("local copy")).toBeNull();
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
