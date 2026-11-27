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
  expect(screen.getByRole("status").textContent).toBe(
    "The selected channel blends into the navigation. Make the selected channel lighter or darker.",
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

test.each([
  [
    "ru",
    "Присутствие",
    auroraColors.light.navigation,
    "Индикатор присутствия сливается с навигацией. Измените один из этих цветов.",
  ],
  [
    "en",
    "Navigation",
    "#565656",
    "The presence indicator blends into the navigation. Change either color.",
  ],
  [
    "ru",
    "Уведомления",
    auroraColors.light.navigation,
    "Значок уведомления сливается с навигацией. Измените один из этих цветов.",
  ],
  [
    "en",
    "Notifications",
    "#868686",
    "The notification badge blends into the navigation. Change either color.",
  ],
  [
    "ru",
    "Выбранный канал",
    auroraColors.light.navigation,
    "Выбранный канал сливается с навигацией. Сделайте его светлее или темнее.",
  ],
  [
    "ru",
    "Навигация",
    "#525252",
    "Контраст текста слишком низкий. Измените цвет фона.",
  ],
  [
    "en",
    "Selected channel",
    "#777777",
    "The text is hard to read. Change the background color.",
  ],
  [
    "ru",
    "Выбранный канал",
    "#999999",
    "Выбранная строка в списках станет плохо читаемой. Выберите другой цвет выбранного канала.",
  ],
  [
    "en",
    "Selected channel",
    "#999999",
    "Selected rows in lists will be hard to read. Choose a different color for the selected channel.",
  ],
] as const)(
  "explains the rejected %s field %s with %s",
  (language, label, value, message) => {
    const { close, applied } = open(language);
    const field = screen.getByLabelText<HTMLInputElement>(label);
    const original = field.value;
    const apply = screen.getByRole("button", {
      name: language === "ru" ? "Применить цвета" : "Apply colors",
    });
    fireEvent.change(field, { target: { value } });
    fireEvent.click(apply);
    expect(screen.getByRole("status").textContent).toBe(message);
    expect(field.value).toBe(value);
    expect(device.settings.palettes.light).toEqual(auroraColors.light);
    expect(applied).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: original } });
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.click(apply);
    expect(close).toHaveBeenCalledOnce();
  },
);

test("each failed apply reveals feedback within the form and keeps button focus", () => {
  open("en");
  const status = screen.getByRole("status");
  const fields = status.parentElement;
  if (!fields) throw Error("Missing scrollable appearance fields");
  Object.defineProperty(fields, "scrollHeight", { value: 275 });
  const apply = screen.getByRole("button", { name: "Apply colors" });
  fireEvent.change(screen.getByLabelText("Selected channel"), {
    target: { value: auroraColors.light.navigation },
  });
  apply.focus();
  fireEvent.click(apply);
  expect(fields.scrollTop).toBe(275);
  expect(document.activeElement).toBe(apply);
  fields.scrollTop = 0;
  fireEvent.click(apply);
  expect(fields.scrollTop).toBe(275);
  expect(document.activeElement).toBe(apply);
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
