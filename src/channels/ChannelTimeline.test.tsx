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
import * as markdownDocument from "./published-post-document.ts";

import "./workspace-dom.test-utils.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
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
  expect(rows[1].querySelector(".published-post")?.textContent).toBe(
    "<img src=x>\nSecond line",
  );
  expect(within(rows[1]).getByText("edited")).toBeTruthy();
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

test("keeps different years separate when their compact labels match", () => {
  const pageAcrossYears = page(
    post("new", Date.UTC(2026, 6, 1)),
    post("old", Date.UTC(2020, 6, 1)),
  );
  const { container, rerender } = render(
    <ChannelTimeline {...base} page={pageAcrossYears} />,
  );
  const labels = () => [...container.querySelectorAll(".timeline-day time")];
  expect(labels().map((el) => el.textContent)).toEqual([
    "Wednesday, July 1",
    "Wednesday, July 1",
  ]);
  expect(labels().map((el) => el.getAttribute("title"))).toEqual([
    "Wednesday, July 1, 2020",
    "Wednesday, July 1, 2026",
  ]);
  rerender(<ChannelTimeline {...base} locale="ru" page={pageAcrossYears} />);
  expect(labels().map((el) => el.textContent)).toEqual([
    "среда, 1 июля",
    "среда, 1 июля",
  ]);
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

test("opens the published source row and shows only an authoritative collapsed count", () => {
  const open = vi.fn();
  const at = Date.UTC(2026, 10, 25, 12, 30);
  const root = {
    ...post("root", at),
    threadSummary: {
      replyCount: 2,
      participantIds: ["ada", "missing"],
      lastReplyAt: at,
    },
  };
  const reply = { ...post("flat-reply", at + 1), rootId: root.id };
  const empty = {
    ...post("new", at + 2),
    threadSummary: { replyCount: 0, participantIds: null, lastReplyAt: 0 },
  };
  const props = { ...base, page: page(empty, reply, root), onOpenThread: open };
  const { rerender } = render(
    <ChannelTimeline {...props} collapsedThreads openThreadPostId={root.id} />,
  );
  const rows = screen.getAllByRole("article");
  const count = within(rows[0]).getByRole("button", {
    name: /Open thread, 2 replies, Last reply: /,
  });
  expect(count.getAttribute("aria-expanded")).toBe("true");
  expect(count.querySelector("time")?.dateTime).toBe(
    new Date(at).toISOString(),
  );
  expect(count.querySelector(".timeline-participants")?.textContent).toBe("AL");
  fireEvent.click(count);
  const flat = within(rows[1]).getByRole("button", { name: "Open thread" });
  flat.focus();
  expect(document.activeElement).toBe(flat);
  fireEvent.click(flat);
  fireEvent.click(within(rows[2]).getByRole("button", { name: "Open thread" }));
  expect(open.mock.calls).toEqual([[root], [reply], [empty]]);
  rerender(<ChannelTimeline {...props} collapsedThreads={false} />);
  expect(screen.getAllByRole("button", { name: "Open thread" })).toHaveLength(
    3,
  );
  expect(screen.queryByText("2 replies")).toBeNull();
});

test.each([
  [1, "1 ответ"],
  [3, "3 ответа"],
  [11, "11 ответов"],
  [21, "21 ответ"],
  [22, "22 ответа"],
] as const)(
  "pluralizes %i replies and omits unavailable dates and profiles",
  (replyCount, expected) => {
    const root = {
      ...post("root", 1),
      threadSummary: {
        replyCount,
        participantIds: null,
        lastReplyAt: Number.MAX_SAFE_INTEGER,
      },
    };
    render(
      <ChannelTimeline
        {...base}
        locale="ru"
        page={page(root)}
        collapsedThreads
        onOpenThread={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", {
      name: `Открыть тред, ${expected}`,
    });
    expect(button.textContent).toBe(expected);
    expect(button.querySelector("time, .timeline-participants")).toBeNull();
  },
);

test("offers no thread action on an outgoing row even after it acquires a server ID", () => {
  const outgoing = {
    sequence: 1,
    pendingId: "local",
    channelId: "general",
    rootId: null,
    message: "Pending",
    createdAt: 1,
    previousLogin: false,
    confirmedPostId: "server",
    attempt: 1,
    refusal: null,
  };
  const props = {
    ...base,
    page: null,
    onOpenThread: vi.fn(),
    collapsedThreads: true,
  };
  const { rerender } = render(
    <ChannelTimeline
      {...props}
      messages={[
        {
          id: outgoing.pendingId,
          outgoing,
          message: outgoing.message,
          createAt: 1,
          editAt: 0,
          isPinned: false,
          userId: "ada",
        },
      ]}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
  const confirmed = { ...post("server", 1), localId: outgoing.pendingId };
  rerender(<ChannelTimeline {...props} messages={[confirmed]} />);
  fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
  expect(props.onOpenThread).toHaveBeenCalledWith(confirmed);
});

test("restores the channel reader when a compact thread hides the feed across updates", () => {
  const rows = page(post("second", 2), post("first", 1));
  const feed = (hidden: boolean, data: LocalChannelWindow) => (
    <div hidden={hidden}>
      <ChannelTimeline {...base} page={data} />
    </div>
  );
  const { rerender } = render(feed(false, rows));
  const pane = screen.getByRole("region");
  const hidden = () => Boolean(pane.closest("[hidden]"));
  let top = 240;
  Object.defineProperties(pane, {
    clientHeight: { get: () => (hidden() ? 0 : 200) },
    scrollHeight: { get: () => (hidden() ? 0 : 800) },
    scrollTop: {
      get: () => (hidden() ? 0 : top),
      set: (value: number) => {
        top = value;
      },
    },
  });
  rerender(feed(true, rows));
  const updated = page(post("third", 3), ...rows.posts);
  rerender(feed(true, updated));
  rerender(feed(false, updated));
  expect(pane.scrollTop).toBe(240);
});

test("tight Markdown list items keep inline text beside their nested list; loose items keep paragraphs", () => {
  const message =
    "1. Mobile\n   - Light\n   - Dark\n2. Desktop\n\n---\n\n- First paragraph\n\n  Second paragraph\n";
  const { container } = render(
    <ChannelTimeline
      {...base}
      page={page({ ...post("layout", 1000), message })}
    />,
  );
  const body = container.querySelector(".published-post");
  if (!body) throw Error("Missing published post");
  expect(body.querySelector("ol > li")?.firstChild?.textContent).toBe("Mobile");
  expect(body.querySelector("ol > li")?.firstElementChild?.tagName).toBe("UL");
  expect(
    [...body.querySelectorAll(".post-loose-list > li > p")].map(
      (el) => el.textContent,
    ),
  ).toEqual(["First paragraph", "Second paragraph"]);
});

test("reads the published body with native headings, labeled tasks, lists and code; raw text stays inert", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const message = [
    "# Notes",
    "## Release",
    "### Read",
    "#### Four",
    "##### Five",
    "###### Six",
    "",
    "> **Bold** *soft* ~~old~~ `inline`",
    "> > Nested",
    "",
    "3. Third",
    "   - [x] Test light theme",
    "   - [ ] Check dark theme",
    "",
    "---",
    "",
    "Line  ",
    "next",
    "",
    "~~~ts",
    "  const mark = '&amp;';",
    "~~~",
    "",
    "Read [docs](https://example.test/docs) ![](https://example.test/image)",
    "",
    "<small>HTML</small>",
    "",
    "| a | b |",
    "| - | - |",
    "| c | d |",
  ].join("\n");
  const saved = Object.freeze({
    ...post("formatted", 6),
    message,
    messageSource: "Original Markdown for editing",
  });
  const data = page(saved);
  const { container, rerender } = render(
    <ChannelTimeline {...base} page={data} />,
  );
  const row = screen.getByRole("article");
  for (let level = 1; level <= 6; level++)
    expect(within(row).getByRole("heading", { level })).toBeTruthy();
  expect(row.querySelector("blockquote blockquote")?.textContent).toBe(
    "Nested",
  );
  expect(row.querySelector("ol")?.start).toBe(3);
  for (const [index, input] of within(row)
    .getAllByRole<HTMLInputElement>("checkbox")
    .entries()) {
    expect(input.disabled).toBe(true);
    expect(input.checked).toBe(index === 0);
  }
  expect(
    within(row).getByRole("checkbox", { name: "Test light theme" }),
  ).toBeTruthy();
  expect(within(row).getByRole("separator")).toBeTruthy();
  expect(row.querySelector("strong:not(header strong)")?.textContent).toBe(
    "Bold",
  );
  expect(row.querySelector("del")?.textContent).toBe("old");
  expect(row.querySelector("em")?.textContent).toBe("soft");
  expect([...row.querySelectorAll("code")].map((n) => n.textContent)).toEqual([
    "inline",
    "  const mark = '&amp;';",
  ]);
  expect(row.querySelector("br")).toBeTruthy();
  expect(row.textContent).toContain("Read docs Image");
  expect(row.textContent).toContain("<small>HTML</small>");
  expect(row.textContent).toContain("| a | b |\n| - | - |\n| c | d |");
  expect(row.textContent).not.toContain("Original Markdown for editing");
  expect(row.querySelector("a,img,small,table,iframe")).toBeNull();
  expect(container.querySelector(".published-post [tabindex]")).toBeNull();
  rerender(<ChannelTimeline {...base} page={data} locale="ru" />);
  expect(row.textContent).toContain("Read docs Изображение");
  expect(saved.messageSource).toBe("Original Markdown for editing");
});

test("parses 60 mounted canonical bodies once and only reparses the changed message", () => {
  const parse = vi.spyOn(markdownDocument, "publishedPostDocument");
  const history = Array.from({ length: 60 }, (_, i) => ({
    ...post("post-" + i, 100 + i),
    message: `**Body ${i}**`,
  }));
  const { rerender } = render(
    <ChannelTimeline {...base} page={page(...history)} />,
  );
  expect(parse).toHaveBeenCalledTimes(60);
  parse.mockClear();
  rerender(
    <ChannelTimeline
      {...base}
      page={page(...history.map((p) => ({ ...p })))}
      author={() => ({ name: "Known author" })}
      locale="ru"
    />,
  );
  expect(parse).not.toHaveBeenCalled();
  const edited = history.map((p, i) =>
    i === 20 ? { ...p, message: "_Changed_" } : p,
  );
  rerender(<ChannelTimeline {...base} page={page(...edited)} />);
  expect(parse).toHaveBeenCalledExactlyOnceWith({ message: "_Changed_" });
  expect(screen.getByText("Changed").tagName).toBe("EM");
});
