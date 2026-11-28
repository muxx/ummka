import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { CollectionScroll } from "./CollectionScroll.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test.each([
  { removed: [10, 11, 12, 13], closest: 9 },
  { removed: [10], closest: 9 },
  { removed: [8, 9, 10], closest: 11 },
])(
  "read position follows the closest old row after removing $removed",
  ({ removed, closest }) => {
    const pane = createRef<HTMLElement>();
    const rows = Array.from({ length: 100 }, (_, index) => index);
    function list(ids: number[]) {
      return (
        <CollectionScroll pane={pane} label="Messages" preserveLeading>
          {ids.map((id) => (
            <button key={id} type="button" data-collection-post={String(id)}>
              {id}
            </button>
          ))}
        </CollectionScroll>
      );
    }
    const view = render(list(rows));
    const element = pane.current;
    if (!element) throw new Error("Missing collection scroller");
    Object.defineProperty(element, "clientHeight", { value: 150 });
    const geometry = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this === element) return new DOMRect(0, 20, 300, 150);
        const index = Array.prototype.indexOf.call(element.children, this);
        return new DOMRect(0, 20 + index * 40 - element.scrollTop, 280, 40);
      });
    element.scrollTop = 411;
    view.rerender(list(rows.filter((id) => !removed.includes(id))));
    const survivor = view.getByRole("button", { name: String(closest) });
    expect(
      survivor.getBoundingClientRect().top -
        element.getBoundingClientRect().top,
    ).toBe(-11);
    expect(geometry.mock.calls.length).toBeLessThan(20);
  },
);

test.each([0, 17])(
  "prepending newer rows preserves a shallow reading place at scroll %i",
  (scroll) => {
    const pane = createRef<HTMLElement>();
    function list(ids: number[]) {
      return (
        <CollectionScroll pane={pane} label="Messages" preserveLeading keepTop>
          {ids.map((id) => (
            <button key={id} type="button" data-collection-post={String(id)}>
              {id}
            </button>
          ))}
        </CollectionScroll>
      );
    }
    const view = render(list([3, 4, 5, 6]));
    const element = pane.current;
    if (!element) throw new Error("Missing collection scroller");
    Object.defineProperty(element, "clientHeight", { value: 120 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this === element) return new DOMRect(0, 20, 300, 120);
        const index = Array.prototype.indexOf.call(element.children, this);
        return new DOMRect(0, 20 + index * 40 - element.scrollTop, 280, 40);
      },
    );
    element.scrollTop = scroll;
    const anchor = view.getByRole("button", { name: "3" });
    const top = anchor.getBoundingClientRect().top;
    view.rerender(list([1, 2, 3, 4, 5, 6]));
    expect(anchor.getBoundingClientRect().top).toBe(top);
    expect(element.scrollTop).toBe(80 + scroll);
  },
);
