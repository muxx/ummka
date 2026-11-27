import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { createTimelinePostTouch } from "./timeline-post-touch.ts";

const previousHitTest = Object.getOwnPropertyDescriptor(
  document,
  "elementFromPoint",
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (previousHitTest)
    Object.defineProperty(document, "elementFromPoint", previousHitTest);
  else Reflect.deleteProperty(document, "elementFromPoint");
});

function touchSequence(target: HTMLElement, x: number, y: number) {
  const position = { bubbles: true, cancelable: true, clientX: x, clientY: y };
  for (const name of ["pointerdown", "pointerup"]) {
    fireEvent(
      target,
      Object.assign(new MouseEvent(name, position), {
        pointerType: "touch",
        pointerId: 1,
        isPrimary: true,
      }),
    );
  }
  fireEvent.click(target, { ...position, detail: 1 });
}

test("a near-edge touch uses the actual row even when Chromium targets its neighbor", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const open = vi.fn();
  render(
    <section {...createTimelinePostTouch()}>
      <article className="timeline-post">
        <button
          type="button"
          className="timeline-post-actions"
          onClick={() => open("first")}
        >
          First actions
        </button>
      </article>
      <article className="timeline-post">
        <button
          type="button"
          className="timeline-post-actions"
          onClick={() => open("next")}
        >
          Next actions
        </button>
        <a href="#reply">Published link</a>
      </article>
    </section>,
  );
  const first = screen.getByRole("button", { name: "First actions" });
  const next = screen.getByRole("button", { name: "Next actions" });
  const link = screen.getByRole("link", { name: "Published link" });
  link.addEventListener("click", (event) => {
    event.preventDefault();
    open("link");
  });
  const hit = vi.fn((_: number, y: number) => (y < 32 ? first : link));
  Object.defineProperty(document, "elementFromPoint", {
    value: hit,
    configurable: true,
  });

  // The event lands on Next, while its coordinates are still in First.
  touchSequence(next, 368, 31);
  expect(open.mock.calls).toEqual([["first"]]);
  expect(hit).toHaveBeenCalledWith(368, 31);

  touchSequence(link, 160, 40);
  expect(open.mock.calls).toEqual([["first"], ["link"]]);
  // Keyboard activation has no touch coordinates and still enters the real button.
  fireEvent.click(next, { detail: 0 });
  expect(open.mock.calls).toEqual([["first"], ["link"], ["next"]]);
});
