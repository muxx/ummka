import { describe, expect, test } from "vitest";
import {
  applyPalette,
  auroraColors,
  contrast,
  editableRoles,
  PaletteError,
  resolvePalette,
} from "./palette";

describe.each(["light", "dark"] as const)("Aurora %s", (mode) => {
  test("keeps reading text, links, focus and essential outlines legible", () => {
    const p = resolvePalette(mode);
    for (const background of [
      p.canvas,
      p["message-target"],
      p["message-hover"],
    ]) {
      for (const foreground of [p.text, p.muted, p["message-link"]])
        expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(p["on-danger"], p["danger-fill"])).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(p.text, p["message-link"])).toBeGreaterThanOrEqual(3);
    expect(contrast(p["on-accent"], p.accent)).toBeGreaterThanOrEqual(4.5);
    for (const foreground of [p.focus, p["field-border"]])
      expect(contrast(foreground, p.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrast("#ffffff", p.topbar)).toBeGreaterThanOrEqual(4.5);
    const root = document.createElement("div");
    applyPalette(root, mode, p);
    expect(root.style.colorScheme).toBe(mode);
    expect(root.style.getPropertyValue("--text")).toBe(p.text);
    expect(root.style.getPropertyValue("--on-notification")).toBe(
      p["on-notification"],
    );
  });

  test.each(editableRoles)(
    "rejects malformed %s before applying any CSS",
    (role) => {
      for (const color of [
        "#ccc",
        "#112233ff",
        "#12345g",
        "red",
        "var(--canvas)",
        "#abcdef\n",
      ]) {
        expect(() =>
          resolvePalette(mode, { ...auroraColors[mode], [role]: color }),
        ).toThrow(new PaletteError(role));
      }
    },
  );
  test.each(["presence", "selected", "notification"] as const)(
    "identifies a %s indicator against navigation",
    (role) => {
      const colors = {
        ...auroraColors[mode],
        [role]: auroraColors[mode].navigation,
      };
      expect(() => resolvePalette(mode, colors)).toThrow(
        new PaletteError(role, "navigation"),
      );
    },
  );
});

test("uses the unrounded sRGB contrast ratio on either side of the threshold", () => {
  expect(contrast("#000000", "#ffffff")).toBe(21);
  expect(contrast("#000000", "#000000")).toBe(1);
  expect(contrast("#767676", "#ffffff")).toBeGreaterThan(4.5);
  expect(contrast("#777777", "#ffffff")).toBeLessThan(4.5);
  const colors = {
    navigation: "#ffffff",
    presence: "#888888",
    selected: "#000000",
    notification: "#000000",
  };
  expect(resolvePalette("dark", colors).presence).toBe("#888888");
  expect(() =>
    resolvePalette("dark", { ...colors, presence: "#898989" }),
  ).toThrow(new PaletteError("presence", "navigation-hover"));
});

test("custom navigation recomputes its foregrounds and preserves both built-in palettes", () => {
  const dark = resolvePalette("dark");
  const light = resolvePalette("light");
  const colors = {
    navigation: "#ffffff",
    selected: "#061839",
    presence: "#22706a",
    notification: "#172941",
  };
  const altered = resolvePalette("dark", colors);
  expect(altered["on-navigation"]).toBe("#061839");
  expect(altered["on-selected"]).toBe("#ffffff");
  expect(altered["on-notification"]).toBe("#ffffff");
  expect(altered.topbar).toBe(dark.topbar);
  expect(resolvePalette("dark")).toEqual(dark);
  expect(resolvePalette("light")).toEqual(light);
  expect(light.topbar).toBe("#172941");
});

test("checks secondary text when the selected row is hovered", () => {
  const palette = resolvePalette("dark");
  expect(
    contrast(palette.muted, palette["row-selected-hover"]),
  ).toBeGreaterThanOrEqual(4.5);
  expect(() =>
    resolvePalette("dark", { ...auroraColors.dark, selected: "#ffffff" }),
  ).toThrow(PaletteError);
  expect(() =>
    resolvePalette("light", {
      ...auroraColors.light,
      navigation: "#ffffff",
      selected: "#061839",
      notification: "#061839",
      presence: "#061839",
    }),
  ).toThrow(new PaletteError("muted", "row-selected"));
});

test.each(["light", "dark"] as const)(
  "%s links and keyboard focus follow their actual surfaces",
  (mode) => {
    const p = resolvePalette(mode);
    for (const surface of [
      p.canvas,
      p.surface,
      p["row-hover"],
      p["row-selected"],
      p["row-selected-hover"],
      p["message-hover"],
      p["message-target"],
    ]) {
      expect(contrast(p.link, surface)).toBeGreaterThanOrEqual(4.5);
    }
    for (const surface of [p.navigation, p["navigation-hover"]]) {
      expect(contrast(p["on-navigation"], surface)).toBeGreaterThanOrEqual(4.5);
      for (const role of [p.presence, p.selected, p.notification])
        expect(contrast(role, surface)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(p["on-selected"], p.selected)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p["on-topbar"], p.topbar)).toBeGreaterThanOrEqual(4.5);
  },
);
