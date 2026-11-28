import { beforeEach, expect, test, vi } from "vitest";
import { devicePaneWidths, paneGeometry } from "./pane-widths.ts";

beforeEach(() => localStorage.clear());

test("keeps choices per device, independently across windows and pane kinds", () => {
  const first = devicePaneWidths(localStorage),
    otherWindow = devicePaneWidths(localStorage);
  first.set("right", 430);
  otherWindow.set("thread", 375);
  first.set("navigation", 240);
  expect(otherWindow.read()).toEqual({
    right: 430,
    thread: 375,
    navigation: 240,
  });
  first.set("right", null);
  expect(devicePaneWidths(localStorage).read()).toEqual({
    thread: 375,
    navigation: 240,
  });
  for (const bad of ["0", "-50", "9007199254740992", "32.5", "0x100", "12em"]) {
    localStorage.setItem("ummka.layout.width.right", bad);
    expect(first.read().right).toBeUndefined();
  }
  expect(() => first.set("thread", NaN)).toThrow(RangeError);
  const refusal = new Error("Storage rejected the change");
  const unavailable = devicePaneWidths({
    getItem: vi.fn(),
    removeItem: vi.fn(),
    setItem: () => {
      throw refusal;
    },
  });
  expect(() => unavailable.set("navigation", 220)).toThrow(refusal);
});

test("uses the prototype breakpoints and fits a conversation between the panels", () => {
  expect(paneGeometry(740, {}, "right")).toBeNull();
  for (const width of [
    741, 820, 900, 901, 1100, 1101, 1180, 1200, 1201, 1440, 1680, 1681, 2560,
  ]) {
    expect(
      paneGeometry(width, { navigation: 900 }, "closed")?.navigation,
    ).toEqual({
      min: 168,
      max: 420,
      width: 420,
    });
    for (const navigation of [168, 240, 420, 1200]) {
      const bounds = paneGeometry(width, { navigation, right: 999 }, "right");
      if (!bounds) throw Error("Expected desktop geometry.");
      const { right, navigation: left } = bounds;
      expect(right.width).toBe(right.max);
      expect(left.width).toBeLessThanOrEqual(left.max);
      expect(width - left.width - right.width).toBeGreaterThanOrEqual(
        Math.min(352, width - 168 - right.min),
      );
      expect(right.expanded).toBeLessThanOrEqual(Math.round(width * 0.6));
    }
  }
  expect(paneGeometry(1440, {}, "right")).toEqual({
    navigation: { width: 244, min: 168, max: 420 },
    right: { width: 400, min: 304, max: 464, expanded: 864 },
  });
  expect(paneGeometry(901, {}, "right")?.navigation.width).toBe(216);
  expect(paneGeometry(900, {}, "right")?.navigation.width).toBe(180);
});

test("changes the default and upper bounds at the documented breakpoints", () => {
  const snapshot = (width: number) => {
    const geometry = paneGeometry(width, {}, "right");
    if (!geometry) return null;
    return [
      geometry.navigation.width,
      geometry.right.min,
      geometry.right.width,
      geometry.right.max,
    ];
  };
  expect(
    [740, 741, 900, 901, 1100, 1101, 1200, 1201, 1680, 1681].map(snapshot),
  ).toEqual([
    null,
    [168, 264, 264, 264],
    [180, 264, 300, 368],
    [216, 304, 333, 333],
    [216, 304, 400, 400],
    [244, 304, 400, 400],
    [244, 304, 400, 400],
    [244, 304, 400, 464],
    [244, 304, 400, 464],
    [244, 304, 500, 776],
  ]);
});

test("a temporary resize leaves the user's preferred width intact", () => {
  const stored = { right: 450, thread: 375, navigation: 320 };
  expect(paneGeometry(1440, stored, "right")?.right.width).toBe(450);
  expect(paneGeometry(820, stored, "right")?.right.width).toBe(264);
  expect(paneGeometry(1440, stored, "right")?.right.width).toBe(450);
  const thread = { thread: 800, navigation: 320 };
  expect(paneGeometry(1440, thread, "thread")?.right.width).toBe(800);
  expect(paneGeometry(820, thread, "thread")?.single).toBe(true);
  expect(paneGeometry(1440, thread, "thread")?.right.width).toBe(800);
});

test.each([
  [820, 180, 0, 640],
  [1024, 216, 300, 508],
  [1180, 244, 360, 576],
  [1440, 244, 400, 796],
])(
  "fits the expanded inbox list and thread at %i px",
  (width, nav, list, detail) => {
    const bounds = paneGeometry(width, {}, "thread");
    expect(bounds?.navigation.width).toBe(nav);
    expect(bounds?.right.expanded).toBe(detail);
    expect(width - nav - detail).toBe(list);
    expect(Boolean(bounds?.single)).toBe(list === 0);
  },
);

test("fits the split and clamps thread preferences to the space after navigation", () => {
  expect(paneGeometry(975, {}, "thread")?.single).toBe(true);
  expect(paneGeometry(976, {}, "thread")?.right).toEqual({
    width: 460,
    min: 460,
    max: 460,
    expanded: 460,
  });
  expect(
    paneGeometry(1100, { navigation: 201 }, "thread")?.right.expanded,
  ).toBe(599);
  expect(
    paneGeometry(1100, { navigation: 200 }, "thread")?.right.expanded,
  ).toBe(540);
  expect(paneGeometry(1440, { thread: 400 }, "thread")?.right.width).toBe(756);
  expect(paneGeometry(1440, { thread: 1000 }, "thread")?.right.width).toBe(896);
  expect(paneGeometry(1180, { navigation: 420 }, "thread")?.right).toEqual({
    width: 460,
    min: 460,
    max: 460,
    expanded: 460,
  });
  expect(paneGeometry(390, {}, "thread")).toBeNull();
});
