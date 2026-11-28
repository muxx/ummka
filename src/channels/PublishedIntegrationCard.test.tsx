import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { IntegrationCard } from "../mattermost/integration-cards.ts";
import { PostBodyDisclosure } from "./PostBodyDisclosure.tsx";
import { PublishedPostBody, PublishedPostCards } from "./PublishedPostBody.tsx";
import { PublishedLinkNavigation } from "./PublishedPostLink.tsx";
import {
  capturePublishedReadingOrigin,
  publishedOriginLink,
} from "./published-reading-history.ts";

const serverUrl = "https://chat.example.org/";
const url = `${serverUrl}sever/pl/target`;
const watches = new Set<() => void>();
const locale = "en";
const authorName = "Bot";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private measure: () => void) {}
      observe() {
        watches.add(this.measure);
      }
      disconnect() {
        watches.delete(this.measure);
      }
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: vi.fn(),
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("renders ordered, structured, linked card text from the cached data", async () => {
  const open = vi.fn();
  const cards: IntegrationCard[] = [
    {
      pretext: "Staging result",
      authorName: "CI Bot",
      authorLink: url,
      title: "Build report",
      titleLink: url,
      text: "**Verified.**",
      color: "#4e927d",
      fields: [
        { title: "Platform", value: "Android", short: true },
        { title: " ", value: " ", short: true },
        { title: "Issues", value: "0", short: true },
        { value: `[Log](${url})\n\n**Ready**`, short: true },
        { title: "Build", short: false },
      ],
      footer: "Nightly report",
    },
    { color: "invalid", fields: [{ title: "Device", short: false }] },
    { fields: [], footer: "Footer only" },
    { fields: [], pretext: "Introduction only" },
    { fields: [], text: " " },
  ];
  render(
    <PublishedLinkNavigation value={{ serverUrl, open }}>
      <PublishedPostCards
        cards={cards}
        locale={locale}
        authorName={authorName}
      />
    </PublishedLinkNavigation>,
  );

  const title = screen.getByRole("heading", { level: 3, name: "Build report" });
  const card = title.closest<HTMLElement>("[data-published-card]");
  if (!card) throw Error("Card is missing");
  expect(card.previousElementSibling?.textContent).toBe("Staging result");
  expect(card.style.borderInlineStartColor).toBe("rgb(78, 146, 125)");
  expect(within(card).getByText("Verified.").tagName).toBe("STRONG");
  expect(within(card).getByText("Nightly report")).toBeDefined();
  const fields = Array.from(card.querySelectorAll("dl > div"));
  expect(fields.map((field) => field.querySelector("dt")?.textContent)).toEqual(
    ["Platform", "Issues", "", "Build"],
  );
  expect(fields.map((field) => field.hasAttribute("data-paired"))).toEqual([
    true,
    true,
    false,
    false,
  ]);
  expect(fields[1].querySelector("dd")?.textContent).toBe("0");
  expect(within(card).getByText("Ready").tagName).toBe("STRONG");
  expect(
    within(card).getByRole("link", { name: "Log" }).getAttribute("href"),
  ).toBe(url);
  expect(
    screen.getByText("Device").closest<HTMLElement>("[data-published-card]")
      ?.style.borderInlineStartColor,
  ).toBe("");
  expect(
    screen.getByText("Footer only").closest("[data-published-card]"),
  ).toBeTruthy();
  expect(
    screen.getByText("Introduction only").closest("[data-published-card]"),
  ).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();

  const author = within(card).getByRole("link", { name: "CI Bot" });
  await userEvent.click(author);
  expect(open).toHaveBeenCalledWith(url, author);
});

test("uses the last complete line, exposes buried links, and keeps the post and next card separate", async () => {
  let line = 183;
  let height = 235;
  // jsdom has no layout. Size the card body and its two paragraphs.
  const originalRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = originalRange();
    range.getClientRects = () =>
      [
        new DOMRect(10, 100 + line - 20, 40, 20),
        new DOMRect(10, 287, 40, 20),
      ] as unknown as DOMRectList;
    return range;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("post-body-disclosure-content"))
        return new DOMRect(10, 100, 300, 650);
      if (this.classList.contains("published-card-body"))
        return new DOMRect(10, 100, 300, height);
      if (this.textContent === "Buried") return new DOMRect(10, 314, 40, 20);
      return new DOMRect(10, 100, 300, 18);
    },
  );
  const cards = [
    { title: "First", text: `A report\n\n[Buried](${url})`, fields: [] },
    { title: "Next", text: "Another report", fields: [] },
  ];
  render(
    <PublishedLinkNavigation value={{ serverUrl, open: vi.fn() }}>
      <PostBodyDisclosure locale={locale}>
        <PublishedPostBody
          message="Main text"
          locale={locale}
          authorName={authorName}
        />
      </PostBodyDisclosure>
      <PublishedPostCards
        cards={cards}
        locale={locale}
        authorName={authorName}
      />
    </PublishedLinkNavigation>,
  );
  const first = screen
    .getByText("First")
    .closest<HTMLElement>("[data-published-card]");
  const next = screen
    .getByText("Next")
    .closest<HTMLElement>("[data-published-card]");
  if (!first || !next) throw Error("Card is missing");
  const action = within(first).getByRole("button", {
    name: "Show full card: First",
  });
  const otherAction = within(next).getByRole("button", {
    name: "Show full card: Next",
  });
  const postAction = screen.getByRole("button", { name: "Show full message" });
  const viewport = first.querySelector<HTMLElement>(".published-card-viewport");
  const link = first.querySelector("a");
  expect(viewport?.style.maxBlockSize).toBe("183px");
  expect(link?.closest("[inert]")).toBeTruthy();
  expect(first.closest(".post-body-disclosure")).toBeNull();

  line = 169;
  act(() => {
    for (const measure of watches) measure();
  });
  expect(viewport?.style.maxBlockSize).toBe("169px");

  const user = userEvent.setup();
  action.focus();
  await user.keyboard("{Enter}");
  expect(action.getAttribute("aria-expanded")).toBe("true");
  expect(action.getAttribute("aria-label")).toBe("Collapse card: First");
  expect(otherAction.getAttribute("aria-expanded")).toBe("false");
  expect(postAction.getAttribute("aria-expanded")).toBe("false");
  expect(link?.closest("[inert]")).toBeNull();
  await user.tab();
  expect(document.activeElement).toBe(link);
  await user.click(action);
  expect(link?.closest("[inert]")).toBeTruthy();

  height = 200;
  act(() => {
    for (const measure of watches) measure();
  });
  expect(within(first).queryByRole("button")).toBeNull();
});

test("returns to a repeated link in its card section after an edit and rejects a neighboring match", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 240, 160),
  );
  const first: IntegrationCard = {
    text: `[Same](${url}) · [Same](${url})`,
    fields: [],
  };
  const second: IntegrationCard = { fields: [], text: `[Other](${url})` };
  function fixture(cards: IntegrationCard[]) {
    return (
      <PublishedLinkNavigation value={{ serverUrl, open: vi.fn() }}>
        <section className="timeline-scroll">
          <article data-post-id="post">
            <PublishedPostBody
              message={`[Same](${url})`}
              locale={locale}
              authorName={authorName}
            />
            <PublishedPostCards
              cards={cards}
              locale={locale}
              authorName={authorName}
            />
          </article>
        </section>
      </PublishedLinkNavigation>
    );
  }
  const { container, rerender } = render(fixture([first, second]));
  const row = container.querySelector("article");
  const anchor = row?.querySelectorAll("a")[2];
  if (!row || !anchor) throw Error("Source link is missing");
  const origin = capturePublishedReadingOrigin(anchor, {
    channelId: "room",
    threadRootId: null,
    teamId: "team",
  });
  if (!origin) throw Error("Origin is missing");

  const amended = { ...first, text: `Edited: ${first.text}` };
  rerender(fixture([amended, second]));
  expect(publishedOriginLink(row, origin.link)).toBe(
    row.querySelectorAll("a")[2],
  );

  rerender(fixture([second]));
  expect(publishedOriginLink(row, origin.link)).toBeUndefined();
});
