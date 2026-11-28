import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { LocalPost } from "../mattermost/local-history.ts";
import type { TimelineMessage } from "./conversation-rows.ts";
import { TimelineDays } from "./TimelineDays.tsx";

const platform = vi.hoisted(() => ({ android: false }));
vi.mock("../build-platform.ts", () => ({
  get isAndroid() {
    return platform.android;
  },
}));
afterEach(() => {
  cleanup();
  platform.android = false;
});

const midnight = Date.UTC(2026, 10, 29);
const confirmed = {
  channelId: "channel",
  rootId: null,
  userId: "ada",
  type: "",
  editAt: 0,
  message: "",
  messageSource: null,
  hashtags: "",
  isPinned: false,
  fromWebhook: false,
  displayPriority: "standard",
  aiAttribution: { kind: "none" },
} as const;
function post(id: string, createAt: number, changes?: Partial<LocalPost>) {
  return { ...confirmed, id, createAt, updateAt: createAt, ...changes };
}
function timeline(
  messages: TimelineMessage[],
  options?: Partial<
    Pick<Parameters<typeof TimelineDays>[0], "timeZone" | "author" | "boundary">
  >,
) {
  return (
    <TimelineDays
      messages={messages}
      locale="en"
      timeZone="UTC"
      author={() => ({ name: "Ada", isBot: false })}
      unknownDate="Unknown date"
      {...options}
    >
      {(row, continuation) => (
        <article key={row.id} data-continuation={continuation || undefined}>
          {row.id}
        </article>
      )}
    </TimelineDays>
  );
}
const continued = () =>
  screen
    .getAllByRole("article")
    .map((row) => row.hasAttribute("data-continuation"));

test("starts after the exact threshold, local day, and a supplied separator", () => {
  const rows = [
    post("before midnight", midnight - 1),
    post("after midnight", midnight),
    post("below threshold", midnight + 299_999),
    post("at threshold", midnight + 599_999),
    post("across divider", midnight + 600_000),
    post("after divider", midnight + 600_001),
  ];
  const boundary = {
    index: 4,
    node: <hr aria-label="Unread replies" key="unread" />,
  };
  const { rerender } = render(timeline(rows, { boundary }));
  expect(continued()).toEqual([false, false, true, false, false, true]);
  expect(
    screen.getByRole("separator", { name: "Unread replies" }).nextElementSibling
      ?.textContent,
  ).toBe("across divider");
  rerender(timeline(rows, { boundary, timeZone: "America/Los_Angeles" }));
  expect(continued()).toEqual([false, true, true, false, false, true]);
});

test.each([
  { fromWebhook: true },
  { fromWebhook: undefined },
  { type: "system_header_change" },
  { type: "burn_on_read" },
  { displayPriority: undefined },
  { aiAttribution: undefined },
  { userId: "someone-else" },
  { rootId: "different-root" },
  { channelId: "different-channel" },
] satisfies Partial<LocalPost>[])(
  "keeps a full heading on both sides of %j",
  (change) => {
    render(
      timeline([
        post("first", midnight),
        post("exception", midnight + 1, change),
        post("following", midnight + 2),
      ]),
    );
    expect(continued()).toEqual([false, false, false]);
  },
);

test.each([
  { displayPriority: "important" },
  { displayPriority: "urgent" },
  { displayPriority: "other" },
  { editAt: midnight + 2 },
] satisfies Partial<LocalPost>[])(
  "requires its own heading for %j and can start a group",
  (change) => {
    render(
      timeline([
        post("first", midnight),
        post("with separate header", midnight + 1, change),
        post("following", midnight + 2),
      ]),
    );
    expect(continued()).toEqual([false, false, true]);
  },
);

test("uses the observed AI source and requires a full heading when the source has a label", () => {
  function attributed(
    id: string,
    offset: number,
    userId: string,
    hasUsername = false,
  ) {
    return post(id, midnight + offset, {
      aiAttribution: { kind: "source", userId, hasUsername },
    });
  }
  render(
    timeline([
      post("regular", midnight),
      attributed("named AI", 1, "bot", true),
      attributed("same named AI", 2, "bot", true),
      attributed("same source without label", 3, "bot"),
      attributed("different source", 4, "other"),
      post("without source", midnight + 5),
    ]),
  );
  expect(continued()).toEqual([false, false, false, true, false, false]);
});

test("Android holds both bot headings and waits for an unknown profile", () => {
  const first = post("first", midnight);
  const next = post("next", midnight + 1);
  const rows = [first, next];
  const bot = () => ({ name: "Builder", isBot: true });
  const { rerender } = render(timeline(rows, { author: bot }));
  expect(continued()).toEqual([false, true]);
  platform.android = true;
  rerender(timeline(rows, { author: bot }));
  expect(continued()).toEqual([false, false]);
  rerender(timeline(rows, { author: () => undefined }));
  expect(continued()).toEqual([false, false]);
  rerender(timeline(rows));
  expect(continued()).toEqual([false, true]);
});

test("a local delivery block stays separate from both neighboring published messages", () => {
  const createdAt = midnight + 1;
  render(
    timeline([
      post("first", midnight),
      {
        id: "pending",
        userId: "ada",
        createAt: createdAt,
        editAt: 0,
        message: "Not delivered",
        isPinned: false,
        outgoing: {
          sequence: 1,
          pendingId: "pending",
          channelId: "channel",
          rootId: null,
          message: "Not delivered",
          createdAt,
          previousLogin: false,
          confirmedPostId: null,
          files: [],
          attempt: 1,
          refusal: null,
        },
      },
      post("following", midnight + 2),
    ]),
  );
  expect(continued()).toEqual([false, false, false]);
});
