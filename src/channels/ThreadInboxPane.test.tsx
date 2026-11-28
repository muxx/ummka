import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ThreadInboxPane } from "./ThreadInboxPane.tsx";
import { openThreadInbox } from "./thread-inbox.ts";
import type {
  ThreadInboxModel,
  ThreadInboxRow,
} from "./use-workspace-thread-inbox.ts";

type Reader = Parameters<typeof openThreadInbox>[0];
const room = "c".repeat(26),
  team = "t".repeat(26),
  user = "u".repeat(26);
function item(key: string, message: string): ThreadInboxRow {
  const id = key.repeat(26);
  return {
    id,
    lastReplyAt: 30,
    lastViewedAt: 0,
    unreadReplies: 0,
    unreadMentions: 0,
    isUrgent: false,
    replyCount: 2,
    participantIds: [],
    post: {
      id,
      userId: user,
      channelId: room,
      rootId: null,
      message,
      messageSource: null,
      type: "",
      hashtags: "",
      isPinned: false,
      createAt: 1,
      updateAt: 1,
      editAt: 0,
    },
  };
}
function Harness({ model }: { model: ThreadInboxModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  return (
    <ThreadInboxPane
      model={model}
      state={state}
      locale="en"
      author={() => ({ name: "River" })}
      channel={() => "# Engineering"}
      choose={() => {}}
    />
  );
}
let atEdge: () => void;
beforeEach(() =>
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        atEdge = () => callback([{ isIntersecting: true }]);
      }
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup() {
  const read = vi.fn<Reader["readFollowedThreads"]>();
  const model = openThreadInbox(
    {
      readFollowedThreads: read,
      readFollowedThreadTotals: async () => ({
        total: 11,
        totalUnreadThreads: 2,
        totalUnreadMentions: 0,
        totalUnreadUrgentMentions: 0,
      }),
    },
    team,
  );
  render(<Harness model={model} />);
  return { model, read };
}

test("keeps accepted entries when the edge fails and gives the first new discussion focus after keyboard retry", async () => {
  const { model, read } = setup(),
    a = item("a", "First"),
    hidden = { ...item("b", "Private body"), post: null },
    c = item("c", "Next **visible** discussion");
  read
    .mockResolvedValueOnce({ items: [a, hidden], nextBefore: hidden.id })
    .mockRejectedValueOnce(Error("network"))
    .mockResolvedValueOnce({ items: [c], nextBefore: null });
  await act(() => model.show("followed"));
  const first = screen.getByRole("button", { name: /First/ });
  expect(screen.queryByText("Private body")).toBeNull();
  await act(async () => {
    atEdge();
    atEdge();
  });
  expect(screen.getByRole("alert").textContent).toContain(
    "Couldn’t load earlier discussions",
  );
  expect(first.isConnected).toBe(true);
  expect(read).toHaveBeenCalledTimes(2);
  const retry = screen.getByRole("button", { name: "Try again" });
  retry.focus();
  fireEvent.click(retry);
  const last = await screen.findByRole("button", {
    name: /Next visible discussion/,
  });
  await waitFor(() => expect(document.activeElement).toBe(last));
  expect(read.mock.calls.map(([q]) => q.before)).toEqual([
    undefined,
    hidden.id,
    hidden.id,
  ]);
  expect(
    screen.getByText("Earlier discussions loaded. End of the list."),
  ).toBeTruthy();
});
test("a page of inaccessible roots keeps the server boundary and a visible attachment-only root can be opened", async () => {
  const { model, read } = setup(),
    hidden = { ...item("b", "Private body"), post: null },
    empty = item("e", "");
  read
    .mockResolvedValueOnce({ items: [hidden], nextBefore: hidden.id })
    .mockResolvedValueOnce({ items: [empty], nextBefore: null });
  await act(() => model.show("followed"));
  expect(
    screen.getByText("No available discussions on this page."),
  ).toBeTruthy();
  expect(screen.queryByText("No followed threads yet.")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Show earlier discussions" }),
  );
  expect(await screen.findByRole("button", { name: /Message/ })).toBeTruthy();
});
test("keeps delayed pages with their own tabs and restores the loaded tab without issuing another request", async () => {
  const { model, read } = setup();
  let first!: (p: Awaited<ReturnType<Reader["readFollowedThreads"]>>) => void;
  read
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve;
        }),
    )
    .mockResolvedValueOnce({
      items: [item("c", "Unread only")],
      nextBefore: null,
    });
  act(() => {
    void model.show("followed");
  });
  const followed = screen.getByRole("tab", { name: "Followed threads" });
  followed.focus();
  fireEvent.keyDown(followed, { key: "ArrowRight" });
  const unread = await screen.findByRole("button", { name: /Unread only/ });
  await act(async () =>
    first({ items: [item("a", "Followed only")], nextBefore: null }),
  );
  expect(unread.isConnected).toBe(true);
  expect(screen.queryByText("Followed only")).toBeNull();
  fireEvent.click(followed);
  expect(
    await screen.findByRole("button", { name: /Followed only/ }),
  ).toBeTruthy();
  expect(read).toHaveBeenCalledTimes(2);
});

test("the header uses the full accessible mention count, an unread dot, or no marker", async () => {
  const { model, read } = setup();
  read.mockResolvedValueOnce({
    items: [
      {
        ...item("a", "Last exact value"),
        unreadReplies: 99,
        unreadMentions: 99,
      },
      {
        ...item("b", "Above the limit"),
        unreadReplies: 126,
        unreadMentions: 125,
      },
      { ...item("c", "Unread without mentions"), unreadReplies: 1 },
      item("d", "Already read"),
    ],
    nextBefore: null,
  });
  await act(() => model.show("followed"));
  for (const [message, count, printed] of [
    ["Last exact value", 99, "99"],
    ["Above the limit", 125, "99+"],
  ] as const) {
    const row = screen.getByRole("button", { name: new RegExp(message) });
    const marker = within(row).getByRole("img", { name: `Mentions: ${count}` });
    expect(marker.textContent).toBe(printed);
    expect(marker.closest(".inbox-row-heading")).not.toBeNull();
    expect(row.querySelector(".inbox-unread-dot")).toBeNull();
  }
  const unread = screen.getByRole("button", {
    name: /Unread without mentions/,
  });
  expect(
    unread.querySelector(".inbox-row-heading .inbox-unread-dot"),
  ).not.toBeNull();
  expect(unread.querySelector(".inbox-mention-count")).toBeNull();
  expect(
    screen
      .getByRole("button", { name: /Already read/ })
      .querySelector(".inbox-row-indicator"),
  ).toBeNull();
});
