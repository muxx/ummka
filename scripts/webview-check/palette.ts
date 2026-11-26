import "../../src/appearance/base.css";
import { applyPalette, resolvePalette } from "../../src/appearance/palette";

export function checkPaletteSurfaces() {
  const sample = document.createElement("section");
  const link = document.createElement("a");
  link.href = "#palette-check";
  const input = document.createElement("input");
  const swatch = document.createElement("span");
  sample.append(link, input, swatch);
  document.body.append(sample);
  try {
    for (const mode of ["light", "dark"] as const) {
      const colors = resolvePalette(mode);
      applyPalette(sample, mode, colors);
      if (
        CSS.supports("-webkit-font-smoothing", "antialiased") &&
        getComputedStyle(link).getPropertyValue("-webkit-font-smoothing") !==
          "antialiased"
      )
        throw Error("palette-font-rendering");
      for (const [surface, linkRole, focusRole] of [
        ["message", "message-link", "focus"],
        ["selected-row", "link", "text"],
        ["navigation", "on-navigation", "on-navigation"],
        ["selected-navigation", "on-selected", "on-selected"],
        ["topbar", "on-topbar", "on-topbar"],
      ] as const) {
        sample.dataset.surface = surface;
        swatch.style.color = colors[linkRole];
        if (
          getComputedStyle(link).color !== getComputedStyle(swatch).color ||
          !getComputedStyle(link).textDecorationLine.includes("underline")
        )
          throw Error(`palette-inline-link-${surface}`);
        input.focus();
        // The hidden native fixture retains the active element but has no OS keyboard focus.
        if (
          input !== document.activeElement ||
          getComputedStyle(input)
            .getPropertyValue("--keyboard-focus")
            .trim() !== colors[focusRole]
        ) {
          throw Error(`palette-focus-color-${surface}`);
        }
      }
    }
  } finally {
    sample.remove();
  }
}
