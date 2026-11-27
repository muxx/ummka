export type PaneWidthMode = "closed" | "right" | "thread";
export type PaneWidthKey = "navigation" | "right" | "thread";
export type PaneWidthChoices = Partial<Record<PaneWidthKey, number>>;
const keys = ["navigation", "right", "thread"] as const;
const storageKey = (pane: PaneWidthKey) => `ummka.layout.width.${pane}`;

export function devicePaneWidths(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
  return {
    read() {
      const values: PaneWidthChoices = {};
      for (const key of keys) {
        const raw = storage.getItem(storageKey(key));
        if (raw === null) continue;
        const value = Number(raw);
        if (Number.isSafeInteger(value) && value > 0 && String(value) === raw)
          values[key] = value;
      }
      return values;
    },
    set(key: PaneWidthKey, width: number | null) {
      if (width === null) {
        storage.removeItem(storageKey(key));
        return;
      }
      if (!Number.isSafeInteger(width) || width <= 0)
        throw new RangeError("Expected a positive integer pane width.");
      storage.setItem(storageKey(key), String(width));
    },
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function paneGeometry(
  width: number,
  preferences: PaneWidthChoices,
  panel: PaneWidthMode,
) {
  if (!Number.isFinite(width) || width <= 740) return null;
  const minNavigation = 168;
  const minRight = width <= 900 ? 264 : 304;
  const minConversation = Math.min(
    panel === "thread" ? 284 : 352,
    width - minNavigation - minRight,
  );
  const maxNavigation = Math.min(
    420,
    width - minConversation - (panel === "closed" ? 0 : minRight),
  );
  const defaultNavigation = width > 1100 ? 244 : width > 900 ? 216 : 180;
  const navigation = clamp(
    preferences.navigation ?? defaultNavigation,
    minNavigation,
    maxNavigation,
  );
  const available = width - navigation;
  const expanded = Math.round(
    Math.min(
      width * 0.6,
      1536,
      available - Math.min(240, minConversation - 48),
    ),
  );
  const maxNormal = width > 1680 ? 776 : width > 1200 ? 464 : 400;
  const maxRight = Math.max(
    minRight,
    Math.min(maxNormal, expanded - 48, available - minConversation),
  );
  const defaultRight = width > 1680 ? 500 : width > 900 ? 400 : 300;
  const rightKey = panel === "thread" ? "thread" : "right";
  const right = clamp(
    preferences[rightKey] ?? defaultRight,
    minRight,
    maxRight,
  );
  return {
    navigation: { width: navigation, min: minNavigation, max: maxNavigation },
    right: { width: right, min: minRight, max: maxRight, expanded },
  };
}
