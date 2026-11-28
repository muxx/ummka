import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
import {
  CollectionReadNotice,
  useCollectionRefreshVisibility,
} from "./CollectionReadNotice.tsx";

afterEach(cleanup);

function Collection({
  status,
  refresh,
}: {
  status: string;
  refresh: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const showRefresh = useCollectionRefreshVisibility(status === "refreshing");
  return (
    <div ref={list}>
      <h2 ref={heading}>Saved messages</h2>
      <CollectionReadNotice
        kind="all"
        status={status}
        showRefresh={showRefresh}
        hasResponse
        online
        language="en"
        list={list}
        heading={heading}
        refresh={refresh}
      />
      <button type="button" data-collection-post="saved">
        Preserved message
      </button>
    </div>
  );
}

test("keeps the retry handoff and original rows while delaying the refresh status", () => {
  vi.useFakeTimers();
  try {
    const refresh = vi.fn();
    const view = render(<Collection status="network" refresh={refresh} />);
    const row = screen.getByRole("button", { name: "Preserved message" });
    const retry = screen.getByRole("button", { name: /Retry update:/ });
    retry.focus();
    fireEvent.click(retry);
    expect(refresh).toHaveBeenCalledOnce();
    const notice = document.activeElement;
    view.rerender(<Collection status="refreshing" refresh={refresh} />);
    expect(document.activeElement).toBe(notice);
    expect(notice?.hasAttribute("data-quiet")).toBe(true);
    act(() => vi.advanceTimersByTime(999));
    expect(screen.queryByText("Updating the list…")).toBeNull();
    expect(screen.getByRole("button", { name: "Preserved message" })).toBe(row);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("Updating the list…")).toBeTruthy();
    expect(document.activeElement).toBe(notice);
    view.rerender(<Collection status="ready" refresh={refresh} />);
    expect(screen.queryByText("Updating the list…")).toBeNull();
    expect(document.activeElement).toBe(row);
  } finally {
    vi.useRealTimers();
  }
});

test("cancels the pending announcement when a quick refresh completes", () => {
  vi.useFakeTimers();
  try {
    const refresh = vi.fn();
    const view = render(<Collection status="refreshing" refresh={refresh} />);
    const row = screen.getByRole("button", { name: "Preserved message" });
    row.focus();
    expect(screen.queryByText("Updating the list…")).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    view.rerender(<Collection status="ready" refresh={refresh} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText("Updating the list…")).toBeNull();
    expect(document.activeElement).toBe(row);
  } finally {
    vi.useRealTimers();
  }
});
