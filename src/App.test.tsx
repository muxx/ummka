import { invoke } from "@tauri-apps/api/core";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { App } from "./App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

test("renders the native host's ready marker without opening a connection", () => {
  render(<App />);
  expect(screen.getByRole("main").textContent).toBe("ummka");
  expect(invoke).not.toHaveBeenCalled();
});
