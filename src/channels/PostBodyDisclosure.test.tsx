import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TimelineMessage } from "./conversation-rows.ts";
import { PostBodyDisclosure } from "./PostBodyDisclosure.tsx";
import * as markdown from "./published-post-document.ts";
import { TimelinePost } from "./TimelinePost.tsx";

const viewportClass = "post-body-disclosure-viewport";
const contentClass = "post-body-disclosure-content";
const watches = new Map<Element, ResizeObserverCallback>();

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        watches.set(element, this.callback);
      }
      disconnect() {
        for (const [element, callback] of watches)
          if (callback === this.callback) watches.delete(element);
      }
    },
  );
  vi.stubGlobal("innerHeight", 1091);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function resized() {
  act(() => {
    for (const callback of watches.values()) (callback as () => void)();
  });
}

test("uses the rendered threshold with a strict boundary and remeasures width and content", () => {
  let rendered = 600;
  let width = 640;
  const internalChanges = vi.spyOn(MutationObserver.prototype, "observe");
  const subscriptions = () =>
    internalChanges.mock.calls.filter(
      ([node]) =>
        node instanceof HTMLElement && node.classList.contains(contentClass),
    );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains(contentClass)
        ? new DOMRect(0, 0, width, rendered)
        : new DOMRect();
    },
  );
  const body = render(
    <PostBodyDisclosure locale="en">A tall fixture</PostBodyDisclosure>,
  );
  expect(screen.queryByRole("button")).toBeNull();
  expect(subscriptions()).toHaveLength(0);
  rendered = 601;
  resized();
  const action = screen.getByRole("button", { name: "Show full message" });
  const panel = body.container.querySelector<HTMLElement>(`.${viewportClass}`);
  expect(panel?.id).toBe(action.getAttribute("aria-controls"));
  expect(panel?.style.maxBlockSize).toBe("600px");
  expect(action.getAttribute("aria-expanded")).toBe("false");
  expect(subscriptions()).toHaveLength(1);
  width = 0;
  rendered = 0;
  resized();
  expect(action.isConnected).toBe(true);
  width = 800;
  rendered = 240;
  resized();
  expect(screen.queryByRole("button")).toBeNull();
  expect(panel?.hasAttribute("data-folded")).toBe(false);
});

test("uses Android window height after rotation and keeps the desktop threshold", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains(contentClass)
        ? new DOMRect(0, 0, 440, 400)
        : new DOMRect();
    },
  );
  const android = process.env.TAURI_ENV_PLATFORM === "android";
  const { container } = render(
    <PostBodyDisclosure locale="ru">Ширина не задаёт порог</PostBodyDisclosure>,
  );
  expect(screen.queryByRole("button")).toBeNull();
  act(() => {
    window.innerHeight = 641;
    window.dispatchEvent(new Event("resize"));
  });
  const action = screen.queryByRole("button", { name: "Показать полностью" });
  expect(Boolean(action)).toBe(android);
  const panel = container.querySelector<HTMLElement>(`.${viewportClass}`);
  expect(panel?.style.maxBlockSize).toBe(android ? "375px" : "600px");
});

test("expands by keyboard and preserves the text or the closing button at its reading position", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const paneOffset = this.closest(".timeline-scroll")?.scrollTop ?? 0;
      if (this.classList.contains(contentClass))
        return new DOMRect(0, 0, 500, 1000);
      if (this.classList.contains(viewportClass)) {
        const folded = this.hasAttribute("data-folded");
        return new DOMRect(
          0,
          (folded ? 100 : 120) - paneOffset,
          500,
          folded ? 600 : 1000,
        );
      }
      if (this.classList.contains("post-body-disclosure-action"))
        return new DOMRect(
          0,
          (this.getAttribute("aria-expanded") === "true" ? 1120 : 700) -
            paneOffset,
          150,
          24,
        );
      return new DOMRect();
    },
  );
  const { container } = render(
    <div className="timeline-scroll">
      <PostBodyDisclosure locale="en">A thousand pixels</PostBodyDisclosure>
    </div>,
  );
  const pane = container.querySelector<HTMLElement>(".timeline-scroll");
  if (!pane) throw Error("Missing timeline");
  pane.scrollTop = 250;
  const action = screen.getByRole("button", { name: "Show full message" });
  action.focus();
  const keys = userEvent.setup();
  await keys.keyboard("{Enter}");
  expect(screen.getByRole("button", { name: "Collapse message" })).toBe(action);
  expect(action.getAttribute("aria-expanded")).toBe("true");
  expect(pane.scrollTop).toBe(270);
  expect(document.activeElement).toBe(action);
  pane.scrollTop = 840;
  await keys.keyboard(" ");
  expect(action.getAttribute("aria-expanded")).toBe("false");
  expect(pane.scrollTop).toBe(420);
  expect(document.activeElement).toBe(action);
});

test("removes fully clipped controls from sequential focus and remeasures them without altering authored states", async () => {
  let below = 680;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains(contentClass))
        return new DOMRect(0, 0, 500, 1000);
      if (this.classList.contains(viewportClass))
        return new DOMRect(0, 0, 500, 600);
      return new DOMRect(
        0,
        this.hasAttribute("data-below") ? below : 120,
        100,
        24,
      );
    },
  );
  const ui = (managed = false) => (
    <PostBodyDisclosure locale="en">
      <button type="button">Visible action</button>
      <button type="button" data-below>
        Clipped action
      </button>
      <button type="button" data-below inert>
        Authored inert action
      </button>
      <button type="button" data-below inert={managed}>
        Managed action
      </button>
      <button type="button" data-below disabled>
        Disabled action
      </button>
      <dialog open>
        <button type="button" data-below>
          Top layer action
        </button>
      </dialog>
      {createPortal(
        <button type="button" data-below>
          Portal action
        </button>,
        document.body,
      )}
    </PostBodyDisclosure>
  );
  const { rerender } = render(ui());
  const disclosure = screen.getByRole("button", { name: "Show full message" });
  disclosure.scrollIntoView = vi.fn();
  const clipped = screen.getByText("Clipped action");
  const disabled = screen.getByText("Disabled action");
  const authored = screen.getByText("Authored inert action");
  const managed = screen.getByText("Managed action");
  const visible = screen.getByText("Visible action");
  expect(clipped.hasAttribute("inert")).toBe(true);
  expect(managed.hasAttribute("inert")).toBe(true);
  expect(visible.hasAttribute("inert")).toBe(false);
  expect(screen.getByText("Top layer action").hasAttribute("inert")).toBe(
    false,
  );
  expect(screen.getByText("Portal action").hasAttribute("inert")).toBe(false);
  rerender(ui(true));
  below = 550;
  resized();
  expect(clipped.hasAttribute("inert")).toBe(false);
  expect(authored.hasAttribute("inert")).toBe(true);
  expect(managed.hasAttribute("inert")).toBe(true);
  expect(disabled.hasAttribute("disabled")).toBe(true);
  expect(disabled.hasAttribute("inert")).toBe(false);

  clipped.focus();
  below = 680;
  resized();
  expect(clipped.hasAttribute("inert")).toBe(true);
  expect(document.activeElement).toBe(disclosure);
  expect(disclosure.scrollIntoView).toHaveBeenCalledOnce();
  await userEvent.keyboard("{Enter}");
  expect(clipped.hasAttribute("inert")).toBe(false);
  expect(authored.hasAttribute("inert")).toBe(true);
  expect(managed.hasAttribute("inert")).toBe(true);
  expect(disabled.hasAttribute("disabled")).toBe(true);
});

test("keeps the following reading position when a post above the viewport gains a disclosure", () => {
  let sourceHeight = 600;
  vi.stubGlobal("CSS", { escape: (id: string) => id });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const pane = this.closest(".timeline-scroll");
      const preceding = pane?.querySelector('[data-post-id="previous"]');
      const disclosure = preceding?.querySelector("button");
      const top = pane?.scrollTop ?? 0;
      if (this === pane) return new DOMRect(0, 0, 500, 500);
      if (this.classList.contains(contentClass))
        return new DOMRect(0, -top, 500, sourceHeight);
      const precedingHeight = 600 + (disclosure ? 24 : 0);
      if (this === preceding) return new DOMRect(0, -top, 500, precedingHeight);
      return new DOMRect(0, precedingHeight + 70 - top, 500, 40);
    },
  );
  const { container } = render(
    <div className="timeline-scroll">
      <article data-post-id="previous">
        <PostBodyDisclosure locale="en">Earlier content</PostBodyDisclosure>
      </article>
      <article data-post-id="visible">Current reading position</article>
    </div>,
  );
  const pane = container.querySelector<HTMLElement>(".timeline-scroll");
  if (!pane) throw Error("Missing timeline");
  pane.scrollTop = 650;
  sourceHeight = 601;
  resized();
  expect(
    screen.getByRole("button", { name: "Show full message" }),
  ).toBeTruthy();
  expect(pane.scrollTop).toBe(674);
  expect(
    screen.getByText("Current reading position").getBoundingClientRect().top,
  ).toBe(20);
});

test("retains a channel row’s choice after edits and keeps the same post in an open thread independent", async () => {
  let height = 900;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains(contentClass)
        ? new DOMRect(0, 0, 480, height)
        : new DOMRect();
    },
  );
  const parse = vi.spyOn(markdown, "publishedPostDocument");
  const time = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
  const post: TimelineMessage = {
    id: "example-id",
    channelId: "example-channel",
    userId: "user",
    rootId: null,
    message: "Original long body",
    messageSource: null,
    createAt: 1,
    updateAt: 1,
    editAt: 0,
    hashtags: "",
    isPinned: false,
    type: "",
  };
  function lanes(message: string, neighbor: string) {
    const row = { ...post, message, editAt: message === post.message ? 0 : 2 };
    const author = () => ({ name: "Synthetic author" });
    return (
      <>
        <section aria-label="Channel">
          <TimelinePost post={row} author={author} time={time} locale="en" />
          <TimelinePost
            post={{ ...post, id: "neighbor", message: neighbor }}
            author={author}
            time={time}
            locale="en"
          />
        </section>
        <section aria-label="Thread">
          <TimelinePost post={row} author={author} time={time} locale="en" />
        </section>
      </>
    );
  }
  const { rerender } = render(lanes(post.message, "Neighbor"));
  const [channel, neighbor] = within(
    screen.getByRole("region", { name: "Channel" }),
  ).getAllByRole("article");
  const thread = within(screen.getByRole("region", { name: "Thread" }));
  const channelAction = within(channel).getByRole("button", {
    name: "Show full message",
  });
  const threadAction = thread.getByRole("button", {
    name: "Show full message",
  });
  expect(channelAction.getAttribute("aria-controls")).not.toBe(
    threadAction.getAttribute("aria-controls"),
  );
  expect(parse).toHaveBeenCalledTimes(3);
  await userEvent.click(channelAction);
  expect(parse).toHaveBeenCalledTimes(3);
  rerender(lanes(post.message, "Updated neighbor"));
  expect(parse).toHaveBeenCalledTimes(4);
  expect(channelAction.getAttribute("aria-expanded")).toBe("true");
  expect(threadAction.getAttribute("aria-expanded")).toBe("false");
  expect(
    within(neighbor).getByRole("button").getAttribute("aria-expanded"),
  ).toBe("false");
  rerender(lanes("Edited long body", "Updated neighbor"));
  expect(channelAction.getAttribute("aria-expanded")).toBe("true");
  expect(threadAction.getAttribute("aria-expanded")).toBe("false");
  height = 100;
  resized();
  expect(channelAction.isConnected).toBe(false);
  expect(threadAction.isConnected).toBe(false);
});
