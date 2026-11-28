import { act, render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useNextPageButton } from "./use-next-page-button.ts";

function Boundary({
  read,
}: {
  read: (page: number, button: HTMLButtonElement) => void;
}) {
  const button = useNextPageButton(3, read, true);
  return (
    <div>
      <button ref={button} type="button">
        More
      </button>
    </div>
  );
}

test.each([true, false])(
  "reads an upper boundary on approach (outside when attached: %s)",
  (outside) => {
    const read = vi.fn();
    let report!: (isIntersecting: boolean) => void;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          report = (isIntersecting) =>
            callback(
              [
                {
                  isIntersecting,
                  intersectionRatio: Number(isIntersecting),
                } as IntersectionObserverEntry,
              ],
              this as unknown as IntersectionObserver,
            );
        }
        observe() {}
        disconnect() {}
      },
    );
    const bounds = vi
      .spyOn(HTMLButtonElement.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, outside ? -80 : 20, 20, 40));
    const view = render(<Boundary read={read} />);
    try {
      act(() => report(true));
      expect(read).toHaveBeenCalledTimes(outside ? 1 : 0);
      if (!outside) {
        act(() => report(false));
        act(() => report(true));
      }
      expect(read).toHaveBeenCalledExactlyOnceWith(3, view.getByRole("button"));
    } finally {
      view.unmount();
      bounds.mockRestore();
      vi.unstubAllGlobals();
    }
  },
);
