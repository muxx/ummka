import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { EntryWindow } from "./EntryWindow";

test("keeps content in one main landmark and Back outside the drag target", () => {
  const goBack = vi.fn();
  const { rerender } = render(
    <EntryWindow>
      <h1>Connect a server</h1>
    </EntryWindow>,
  );
  expect(
    within(screen.getByRole("main")).getByRole("heading").textContent,
  ).toBe("Connect a server");
  const mobile = ["android", "ios"].includes(
    process.env.TAURI_ENV_PLATFORM ?? "",
  );
  expect(screen.getByRole("main").closest("[data-mobile]") !== null).toBe(
    mobile,
  );
  expect(screen.queryByRole("button")).toBeNull();
  rerender(
    <EntryWindow back={{ label: "Go back", activate: goBack }}>
      <input aria-label="Server address" />
    </EntryWindow>,
  );
  const back = screen.getByRole("button", { name: "Go back" });
  expect(back.hasAttribute("data-tauri-drag-region")).toBe(false);
  expect(
    screen.getByRole("textbox").closest("[data-tauri-drag-region]"),
  ).toBeNull();
  fireEvent.click(back);
  expect(goBack).toHaveBeenCalledOnce();
});
