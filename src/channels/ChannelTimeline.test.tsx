import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { LocalChannelWindow } from "../mattermost/local-history.ts";
import { ChannelTimeline } from "./ChannelTimeline.tsx";

afterEach(cleanup);
const base = {
  channelId: "general",
  locale: "en" as const,
  timeZone: "UTC",
  offline: false,
  author: (id: string) => (id === "ada" ? { name: "Ada Lovelace" } : undefined),
};
const end = { kind: "end" } as const;
function post(
  id: string,
  createAt: number,
  userId = "ada",
): LocalChannelWindow["posts"][number] {
  return {
    id,
    channelId: "general",
    userId,
    createAt,
    updateAt: createAt,
    editAt: 0,
    type: "",
    rootId: null,
    message: id,
    messageSource: null,
    hashtags: "",
    isPinned: false,
  };
}
function page(...posts: LocalChannelWindow["posts"]): LocalChannelWindow {
  return { posts, older: end, newer: end, firstInaccessiblePostTime: 0 };
}

test("renders oldest first, preserves tie order, local calendar days and escaped message text", () => {
  const midnight = Date.UTC(2026, 10, 25);
  const first = post("oldest", midnight - 60_000, "missing");
  const second = {
    ...post("tie-second", midnight),
    message: "<img src=x>\nSecond line",
    editAt: midnight + 1,
    isPinned: true,
  };
  const last = post("tie-first", midnight);
  const data = page(last, second, first);
  const { container, rerender } = render(
    <ChannelTimeline {...base} page={data} />,
  );
  const rows = screen.getAllByRole("article");
  expect(rows.map((el) => el.dataset.postId)).toEqual([
    "oldest",
    "tie-second",
    "tie-first",
  ]);
  expect(within(rows[0]).getByText("Unknown user")).toBeTruthy();
  expect(rows[1].querySelector("img")).toBeNull();
  expect(rows[1].querySelector("p")?.textContent).toBe(
    "<img src=x>\nSecond line (edited)",
  );
  expect(within(rows[1]).getByText("Pinned")).toBeTruthy();
  expect(rows[1].querySelector("time")?.dateTime).toBe(
    new Date(midnight).toISOString(),
  );
  expect(container.querySelectorAll(".timeline-day")).toHaveLength(2);
  rerender(
    <ChannelTimeline
      {...base}
      timeZone="America/Los_Angeles"
      locale="ru"
      page={data}
    />,
  );
  expect(container.querySelectorAll(".timeline-day")).toHaveLength(1);
  expect(screen.getByText("Неизвестный пользователь")).toBeTruthy();
  expect(screen.getByRole("region").tabIndex).toBe(0);
});

test("distinguishes cold, empty, offline, capped and missing parts without claiming a missing author or page", () => {
  const { rerender } = render(
    <ChannelTimeline {...base} page={null} offline />,
  );
  expect(screen.getByRole("status").textContent).toBe("Offline");
  expect(screen.getByText("No history saved on this device yet.")).toBeTruthy();
  rerender(<ChannelTimeline {...base} page={page()} offline />);
  expect(screen.getByRole("status").textContent).toContain(
    "Saved on this device",
  );
  expect(
    screen.getByText("There are no messages in this channel yet."),
  ).toBeTruthy();
  rerender(<ChannelTimeline {...base} page={null} inaccessibleBefore={100} />);
  expect(
    screen.getByText("Earlier messages are unavailable on this server."),
  ).toBeTruthy();
  expect(screen.queryByText("No history saved on this device yet.")).toBeNull();
  const data = {
    ...page(),
    firstInaccessiblePostTime: 100,
    older: { kind: "unknown" as const },
  };
  rerender(<ChannelTimeline {...base} page={data} />);
  expect(
    screen.getByText("No messages in this part of the history."),
  ).toBeTruthy();
  expect(
    screen.getByText("Earlier messages have not been loaded."),
  ).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

test("passes the exact neighboring ids supplied by SQLite and tolerates an unrepresentable date", () => {
  const data = {
    ...page(post("one", Number.MAX_SAFE_INTEGER)),
    older: { kind: "more" as const, postId: "older-id" },
    newer: { kind: "more" as const, postId: "newer-id" },
  };
  const read = vi.fn();
  render(<ChannelTimeline {...base} page={data} onReadEdge={read} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Show earlier messages" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Show later messages" }));
  expect(read.mock.calls).toEqual([
    ["older", "older-id"],
    ["newer", "newer-id"],
  ]);
  expect(screen.getByText("Unknown date")).toBeTruthy();
  expect(screen.getByText("one")).toBeTruthy();
});
