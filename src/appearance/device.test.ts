import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { startAppearance } from "./device";
import { auroraColors, PaletteError } from "./palette";

const root = document.documentElement;
const key = "ummka.appearance.mode";
const lightKey = "ummka.appearance.palette.light";
const darkKey = "ummka.appearance.palette.dark";
let dark: boolean;
let media: EventTarget;
let active: ReturnType<typeof startAppearance>[] = [];
beforeEach(() => {
  dark = false;
  media = new EventTarget();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      expect(query).toBe("(prefers-color-scheme: dark)");
      return Object.assign(media, { matches: dark });
    }),
  );
  localStorage.clear();
});
afterEach(() => {
  for (const controller of active) controller.dispose();
  active = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  root.removeAttribute("style");
  document.body.replaceChildren();
});
function open() {
  const controller = startAppearance(window);
  active.push(controller);
  return controller;
}
function systemChange(matches: boolean) {
  dark = matches;
  Object.assign(media, { matches });
  media.dispatchEvent(new Event("change"));
}
function storageEvent(
  storageArea: Storage,
  item: string | null,
  oldValue: string | null = null,
) {
  window.dispatchEvent(
    new StorageEvent("storage", { key: item, storageArea, newValue: oldValue }),
  );
}

test("uses the system palette before mounting a view, then follows system changes", () => {
  const first = open();
  expect(first.settings.appearance).toBe("system");
  expect(root.style.colorScheme).toBe("light");
  expect(localStorage.getItem(key)).toBeNull();
  systemChange(true);
  expect(root.style.colorScheme).toBe("dark");
  first.setAppearance("light");
  systemChange(false);
  systemChange(true);
  expect(root.style.colorScheme).toBe("light");
  expect(open().settings.appearance).toBe("light");
  first.setAppearance("system");
  expect(root.style.colorScheme).toBe("dark");
});

test("keeps each palette on the device and rejects a bad edit before writing it", () => {
  const controller = open();
  const darkColors = { ...auroraColors.dark, notification: "#eeeecc" };
  controller.setColors("dark", darkColors);
  expect(root.style.getPropertyValue("--notification")).toBe(
    auroraColors.light.notification,
  );
  controller.setAppearance("dark");
  expect(root.style.getPropertyValue("--notification")).toBe("#eeeecc");
  const bytes = localStorage.getItem(darkKey);
  expect(() =>
    controller.setColors("dark", {
      ...darkColors,
      selected: darkColors.navigation,
    }),
  ).toThrow(PaletteError);
  expect(localStorage.getItem(darkKey)).toBe(bytes);
  expect(open().settings.palettes).toEqual({
    light: auroraColors.light,
    dark: darkColors,
  });
});

test("a second window uses the latest saved value even if storage events arrive late", () => {
  const first = open();
  const second = open();
  first.setColors("light", { ...auroraColors.light, presence: "#aaffdd" });
  const older = localStorage.getItem(key);
  second.setAppearance("dark");
  storageEvent(localStorage, key, older);
  expect(first.settings.appearance).toBe("dark");
  expect(second.settings.palettes.light.presence).toBe("#aaffdd");
  localStorage.clear();
  storageEvent(sessionStorage, key);
  storageEvent(localStorage, "another-key");
  expect(first.settings.appearance).toBe("dark");
  storageEvent(localStorage, null);
  expect(first.settings.appearance).toBe("system");
  expect(first.settings.palettes.light).toEqual(auroraColors.light);
});

test("interleaved commits from two windows preserve each independent choice", () => {
  const first = open();
  const second = open();
  const light = { ...auroraColors.light, notification: "#ffeedd" };
  const dark = { ...auroraColors.dark, notification: "#eeeecc" };
  const write = Storage.prototype.setItem;
  const pending = vi.spyOn(Storage.prototype, "setItem");
  pending.mockImplementationOnce(function (this: Storage, item, value) {
    second.setAppearance("dark");
    second.setColors("dark", dark);
    write.call(this, item, value);
  });
  first.setColors("light", light);
  const restored = open().settings;
  expect(restored.appearance).toBe("dark");
  expect(restored.palettes).toEqual({ light, dark });
  storageEvent(localStorage, lightKey);
  expect(second.settings).toEqual(restored);
});

test.each(["{", "null", '{"version":99}', '{"version":1,"value":"blue"}'])(
  "preserves an unreadable setting (%s) until an explicit save",
  (bytes) => {
    localStorage.setItem(key, bytes);
    const controller = open();
    expect(controller.settings.appearance).toBe("system");
    expect(localStorage.getItem(key)).toBe(bytes);
    controller.setAppearance("dark");
    expect(open().settings.appearance).toBe("dark");
  },
);
test("preserves an invalid inactive palette across edits to other settings", () => {
  const invalid = {
    ...auroraColors.dark,
    selected: auroraColors.dark.navigation,
  };
  const bytes = JSON.stringify({ version: 1, value: invalid });
  localStorage.setItem(darkKey, bytes);
  const controller = open();
  controller.setAppearance("dark");
  controller.setColors("light", auroraColors.light);
  expect(controller.settings.appearance).toBe("dark");
  expect(controller.settings.palettes.dark).toEqual(auroraColors.dark);
  expect(localStorage.getItem(darkKey)).toBe(bytes);
  controller.setColors("dark", auroraColors.dark);
  expect(localStorage.getItem(darkKey)).not.toBe(bytes);
});
test("continues in system appearance when browser storage is inaccessible and reports save failure", () => {
  const denied = new DOMException("denied", "SecurityError");
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw denied;
  });
  const controller = open();
  expect(controller.settings.appearance).toBe("system");
  expect(() => controller.setAppearance("dark")).toThrow(denied);
  expect(root.style.colorScheme).toBe("light");
});
test("failed writes preserve the active palette, stored setting and current input", () => {
  const controller = open();
  controller.setAppearance("light");
  const stored = localStorage.getItem(key);
  const input = document.createElement("input");
  document.body.append(input);
  input.value = "Текст";
  input.focus();
  input.setSelectionRange(1, 3);
  const quota = new DOMException("full", "QuotaExceededError");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw quota;
  });
  expect(() => controller.setAppearance("dark")).toThrow(quota);
  expect(root.style.colorScheme).toBe("light");
  expect(localStorage.getItem(key)).toBe(stored);
  expect(document.activeElement).toBe(input);
  expect([input.value, input.selectionStart, input.selectionEnd]).toEqual([
    "Текст",
    1,
    3,
  ]);
});
test("disposes both listeners when a window closes", () => {
  open().dispose();
  systemChange(true);
  expect(root.style.colorScheme).toBe("light");
  localStorage.setItem(key, JSON.stringify({ version: 1, value: "dark" }));
  storageEvent(localStorage, key);
  expect(root.style.colorScheme).toBe("light");
});
