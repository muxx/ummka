import {
  applyPalette,
  auroraColors,
  editableRoles,
  PaletteError,
  type PaletteMode,
  resolvePalette,
  type ThemeColors,
} from "./palette";

const keys = {
  appearance: "ummka.appearance.mode",
  light: "ummka.appearance.palette.light",
  dark: "ummka.appearance.palette.dark",
} as const;
type Appearance = "system" | PaletteMode;
type Settings = Readonly<{
  version: 1;
  appearance: Appearance;
  palettes: Readonly<Record<PaletteMode, ThemeColors>>;
}>;

const defaults: Settings = {
  version: 1,
  appearance: "system",
  palettes: auroraColors,
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

function isColors(value: unknown): value is ThemeColors {
  return (
    object(value) &&
    editableRoles.every((role) => typeof value[role] === "string")
  );
}

function readValue(storage: Storage, key: string): unknown {
  const text = storage.getItem(key);
  if (text === null) return undefined;
  try {
    const entry: unknown = JSON.parse(text);
    return object(entry) && entry.version === 1 ? entry.value : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function storedColors(storage: Storage, mode: PaletteMode): ThemeColors {
  const value = readValue(storage, keys[mode]);
  if (isColors(value)) {
    try {
      resolvePalette(mode, value);
      return value;
    } catch (error) {
      if (!(error instanceof PaletteError)) throw error;
    }
  }
  return defaults.palettes[mode];
}

function readSettings(storage: Storage): Settings {
  const mode = readValue(storage, keys.appearance);
  return {
    version: 1,
    appearance: isAppearance(mode) ? mode : defaults.appearance,
    palettes: {
      light: storedColors(storage, "light"),
      dark: storedColors(storage, "dark"),
    },
  };
}

export function startAppearance(target: Window) {
  const system = target.matchMedia("(prefers-color-scheme: dark)");
  // Storage may be inaccessible on this device. A cosmetic preference must not block first paint.
  function restore() {
    try {
      return readSettings(target.localStorage);
    } catch (error) {
      if (error instanceof DOMException && error.name === "SecurityError")
        return defaults;
      throw error;
    }
  }
  let settings = restore();
  function paint() {
    const mode =
      settings.appearance === "system"
        ? system.matches
          ? "dark"
          : "light"
        : settings.appearance;
    applyPalette(
      target.document.documentElement,
      mode,
      resolvePalette(mode, settings.palettes[mode]),
    );
  }
  function systemChanged() {
    if (settings.appearance === "system") paint();
  }
  function storageChanged(event: StorageEvent) {
    if (
      event.key !== null &&
      !Object.values(keys).some((key) => key === event.key)
    )
      return;
    if (event.storageArea !== target.localStorage) return;
    // Read the current value. An older queued event may arrive after a newer local edit.
    settings = restore();
    paint();
  }
  function save(key: string, value: Appearance | ThemeColors) {
    // Each action commits one independent choice. Other windows may update either of the others.
    target.localStorage.setItem(key, JSON.stringify({ version: 1, value }));
    settings = readSettings(target.localStorage);
    paint();
  }
  paint();
  system.addEventListener("change", systemChanged);
  target.addEventListener("storage", storageChanged);
  return {
    get settings() {
      return settings;
    },
    setAppearance(appearance: Appearance) {
      if (!isAppearance(appearance)) throw new TypeError("Unknown appearance");
      save(keys.appearance, appearance);
    },
    setColors(mode: PaletteMode, colors: ThemeColors) {
      resolvePalette(mode, colors);
      save(keys[mode], colors);
    },
    dispose() {
      target.removeEventListener("storage", storageChanged);
      system.removeEventListener("change", systemChanged);
    },
  };
}
