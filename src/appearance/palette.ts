export type PaletteMode = "light" | "dark";

export const editableRoles = [
  "navigation",
  "selected",
  "presence",
  "notification",
] as const;
export type ThemeColors = Readonly<
  Record<(typeof editableRoles)[number], string>
>;

export const auroraColors: Readonly<Record<PaletteMode, ThemeColors>> = {
  light: {
    navigation: "#253d62",
    selected: "#81c79d",
    presence: "#81c79d",
    notification: "#faf2eb",
  },
  dark: {
    navigation: "#172941",
    selected: "#66b298",
    presence: "#81c79d",
    notification: "#faf2eb",
  },
};

const surfaces = {
  light: {
    canvas: "#ffffff",
    text: "#18222f",
    muted: "#556171",
    "quote-text": "#4b5767",
    surface: "#f2f5f8",
    "message-hover": "#f3f6f9",
    "message-target": "#fcefdc",
    "row-hover": "#ebf0f5",
    divider: "#dde3ea",
    "strong-divider": "#bfc9d4",
    "field-border": "#7d8a99",
    accent: "#22706a",
    "accent-tint": "#e1f1e9",
    focus: "#2b7f78",
    link: "#176156",
    "message-link": "#177a70",
    error: "#a62c33",
    "danger-fill": "#a62c33",
    topbar: "#172941",
  },
  dark: {
    canvas: "#121a25",
    text: "#e8edf3",
    muted: "#a5b1c0",
    "quote-text": "#b7c1cd",
    surface: "#1a2431",
    "message-hover": "#151d28",
    "message-target": "#211e1a",
    "row-hover": "#1e2936",
    divider: "#273345",
    "strong-divider": "#3a4a5e",
    "field-border": "#5f7086",
    accent: "#81c79d",
    "accent-tint": "#1b3332",
    focus: "#81c79d",
    link: "#8fd9bd",
    "message-link": "#2d977b",
    error: "#ffabb1",
    "danger-fill": "#96353d",
    topbar: "#0f1c2e",
  },
} as const;

const ink = "#061839";
const white = "#ffffff";

function rgb(hex: string) {
  return [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16),
  );
}

function luminance(hex: string) {
  const [red, green, blue] = rgb(hex).map((byte) => {
    const s = byte / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrast(first: string, second: string) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function foreground(background: string) {
  return contrast(background, white) >= contrast(background, ink) ? white : ink;
}

function mix(color: string, weight: number, base: string) {
  const background = rgb(base);
  const bytes = rgb(color).map((byte, index) =>
    Math.round(byte * weight + background[index] * (1 - weight)),
  );
  return `#${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function colorsFor(
  mode: PaletteMode,
  { navigation, selected, presence, notification }: ThemeColors,
) {
  const surface = surfaces[mode];
  const navText = foreground(navigation);
  const weight = mode === "light" ? 0.36 : 0.26;
  return {
    ...surface,
    navigation,
    selected,
    presence,
    notification,
    "on-navigation": navText,
    "on-topbar": white,
    "navigation-muted": mix(navText, 0.78, navigation),
    "navigation-hover": mix(navText, 0.08, navigation),
    "on-selected": foreground(selected),
    "on-notification": foreground(notification),
    "on-accent": foreground(surface.accent),
    "on-danger": foreground(surface["danger-fill"]),
    "row-selected": mix(selected, weight, surface.canvas),
    "row-selected-hover": mix(
      selected,
      mode === "light" ? 0.44 : 0.3,
      surface.canvas,
    ),
  };
}

type Palette = ReturnType<typeof colorsFor>;
type Role = keyof Palette;
export class PaletteError extends Error {
  readonly roles: readonly Role[];
  constructor(...roles: Role[]) {
    super(`Invalid theme colors: ${roles.join(", ")}`);
    this.roles = roles;
  }
}

export function resolvePalette(
  mode: PaletteMode,
  colors = auroraColors[mode],
): Palette {
  for (const role of editableRoles) {
    const color = colors[role];
    if (
      typeof color !== "string" ||
      color.length !== 7 ||
      !/^#[0-9a-f]{6}$/i.test(color)
    ) {
      throw new PaletteError(role);
    }
  }
  const palette = colorsFor(mode, colors);
  function requireContrast(text: Role, background: Role, minimum: number) {
    if (contrast(palette[text], palette[background]) < minimum)
      throw new PaletteError(text, background);
  }
  requireContrast("on-selected", "selected", 4.5);
  requireContrast("on-notification", "notification", 4.5);
  for (const surface of ["navigation", "navigation-hover"] as const) {
    for (const role of ["presence", "notification", "selected"] as const)
      requireContrast(role, surface, 3);
    requireContrast("on-navigation", surface, 4.5);
    requireContrast("navigation-muted", surface, 4.5);
  }
  for (const surface of ["row-selected", "row-selected-hover"] as const) {
    requireContrast("text", surface, 4.5);
    requireContrast("muted", surface, 4.5);
    requireContrast("link", surface, 4.5);
  }
  return palette;
}

export function applyPalette(
  root: HTMLElement,
  mode: PaletteMode,
  palette: Palette,
) {
  for (const [role, value] of Object.entries(palette))
    root.style.setProperty(`--${role}`, value);
  root.dataset.appearance = mode;
  root.style.colorScheme = mode;
}
