import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "../channels/workspace-dom.test-utils.ts";
import AppearanceDialog from "./AppearanceDialog.tsx";
import { startAppearance } from "./device.ts";
import { auroraColors } from "./palette.ts";

let device: ReturnType<typeof startAppearance>;
vi.mock("./window", () => ({
  get windowAppearance() {
    return device;
  },
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () =>
    Object.assign(new EventTarget(), { matches: false }),
  );
  localStorage.clear();
  device = startAppearance(window);
});
afterEach(() => {
  cleanup();
  device.dispose();
  vi.restoreAllMocks();
});

function open(language: "en" | "ru") {
  const close = vi.fn(),
    applied = vi.fn();
  render(
    <AppearanceDialog
      language={language}
      close={close}
      applied={applied}
      opener={{ current: null }}
      initialInput="keyboard"
    />,
  );
  return { close, applied };
}

test("invalid contrast keeps the dialog open and only valid changes update this mode", () => {
  const { close, applied } = open("en");
  const selected = screen.getByLabelText<HTMLInputElement>("Selected channel");
  const apply = screen.getByRole("button", { name: "Apply colors" });
  fireEvent.change(selected, {
    target: { value: auroraColors.light.navigation },
  });
  fireEvent.click(apply);
  expect(screen.getByRole("status").textContent).toContain(
    "Insufficient contrast",
  );
  expect(close).not.toHaveBeenCalled();
  expect(device.settings.palettes.light).toEqual(auroraColors.light);
  fireEvent.click(screen.getByRole("button", { name: "Dark" }));
  expect(selected.value).toBe(auroraColors.dark.selected);
  fireEvent.change(screen.getByLabelText("Notifications"), {
    target: { value: "#eeeecc" },
  });
  fireEvent.click(apply);
  expect(device.settings.palettes.dark.notification).toBe("#eeeecc");
  expect(applied).toHaveBeenCalledWith("Custom colors applied");
  expect(close).toHaveBeenCalledOnce();
});

test("an open editor tracks another window and keeps a failed save available for retry", () => {
  const { close, applied } = open("ru");
  const other = startAppearance(window);
  try {
    other.setAppearance("dark");
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "ummka.appearance.mode",
          storageArea: localStorage,
        }),
      ),
    );
    expect(
      screen.getByRole("button", { name: "Тёмный", pressed: true }),
    ).toBeDefined();
    const field = screen.getByLabelText<HTMLInputElement>("Присутствие");
    expect(field.value).toBe(auroraColors.dark.presence);
    fireEvent.change(field, { target: { value: "#aaffdd" } });
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    const apply = screen.getByRole("button", { name: "Применить цвета" });
    fireEvent.click(apply);
    expect(screen.getByRole("status").textContent).toContain(
      "Не удалось сохранить",
    );
    expect(close).not.toHaveBeenCalled();
    expect(applied).not.toHaveBeenCalled();
    expect(field.value).toBe("#aaffdd");
    fireEvent.click(apply);
    expect(device.settings.palettes.dark.presence).toBe("#aaffdd");
    expect(close).toHaveBeenCalledOnce();
  } finally {
    other.dispose();
  }
});
