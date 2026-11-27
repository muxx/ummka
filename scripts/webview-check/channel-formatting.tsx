import { fireEvent, waitFor, within } from "@testing-library/dom";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyPalette, resolvePalette } from "../../src/appearance/palette.ts";
import { isAndroid } from "../../src/build-platform.ts";
import { ChannelTimeline } from "../../src/channels/ChannelTimeline.tsx";
import { PublishedCodeReader } from "../../src/channels/PublishedCodeReader.tsx";
import { PublishedPostBody } from "../../src/channels/PublishedPostBody.tsx";
import { PublishedLinkNavigation } from "../../src/channels/PublishedPostLink.tsx";
import {
  PublishedReaderWindow,
  PublishedTableScreen,
  usePublishedReaderWindow,
} from "../../src/channels/PublishedReaderWindow.tsx";
import { useWorkspaceBack } from "../../src/channels/use-workspace-back.ts";
import type { LocalChannelWindow } from "../../src/mattermost/local-history.ts";
import { fixtureDeadline, fixtureStep } from "./fixture-step.ts";

const longCode = `  const summary = "${"a".repeat(320)}";`;
const extraCell = "wide".repeat(70);
const lastRow = isAndroid ? 78 : 6;
const bodies = [
  "# Notes\n\n## Decisions\n\nRead **bold**, *emphasis* and ~~old~~.",
  "> A quote\n>\n> > Another quote",
  "3. Third\n   - [x] Checked task\n   - [ ] Next task",
  `~~~ts\n${longCode}\n~~~`,
  "See [notes](https://example.test/notes) and ![A diagram](https://example.test/image).",
  "First line  \nSecond line\n\n---",
  "<div>Read as typed</div>",
  [
    "| Name | Status | Score |",
    "| :--- | :---: | ---: |",
    `| **Aurora** | Ready | 17 | ${extraCell} |`,
    ...Array.from(
      { length: lastRow },
      (_, i) => `| Row ${i} | In progress | ${i} |`,
    ),
    "| Last row | *Italic* | `keep  spaces` | Extra | Detail | A | B | C | D | **Last cell** |",
  ].join("\n"),
  "| Short |\n| --- |\n| Fits |",
  "A short inline `const  value` with an ampersand &amp; text.",
  "A paragraph with ordinary readable text.\n\n~~~\nlet value;\n~~~",
  `| Long |\n| --- |\n| ${"wrap generously ".repeat(140)} |`,
  "| Header only |\n| --- |",
];

function checkDisclosure(host: HTMLElement, width: number) {
  const row = host.querySelector('[data-post-id="disclosure"]');
  const viewport = row?.querySelector<HTMLElement>(
    ".post-body-disclosure-viewport",
  );
  const action = row?.querySelector<HTMLButtonElement>(
    ".post-body-disclosure-action",
  );
  const content = viewport?.firstElementChild;
  if (!viewport || !action || !content)
    throw Error(`Long post disclosure is missing at ${width}px`);
  const measure = (node: Element) => node.getBoundingClientRect().height;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  const limit = isAndroid ? Math.round(innerHeight / 2 + 54) : 600;
  const full = measure(content);
  if (
    full <= limit ||
    !near(measure(viewport), limit) ||
    action.getAttribute("aria-controls") !== viewport.id ||
    action.getAttribute("aria-expanded") !== "false" ||
    action.textContent !== "Show full message"
  )
    throw Error(`Wrong initial folded body at ${width}px`);

  action.scrollIntoView({ block: "nearest" });
  action.focus({ preventScroll: true });
  const top = viewport.getBoundingClientRect().top;
  flushSync(() => action.click());
  if (
    !near(measure(viewport), full) ||
    !near(viewport.getBoundingClientRect().top, top) ||
    action.getAttribute("aria-expanded") !== "true" ||
    String(action.textContent) !== "Collapse message" ||
    document.activeElement !== action
  )
    throw Error(
      `Opening the long post changed its reading position at ${width}px`,
    );

  action.scrollIntoView({ block: "end" });
  const end = action.getBoundingClientRect().top;
  flushSync(() => action.click());
  const bounds = action.getBoundingClientRect();
  const timeline = action.closest(".timeline-scroll")?.getBoundingClientRect();
  if (
    !timeline ||
    !near(measure(viewport), limit) ||
    !near(bounds.top, end) ||
    bounds.top < timeline.top - 1 ||
    bounds.bottom > timeline.bottom + 1 ||
    action.getAttribute("aria-expanded") !== "false" ||
    document.activeElement !== action
  )
    throw Error(`Closing the long post lost its visible action at ${width}px`);
}

type PressRight = (
  kind: "code" | "table",
  width: number,
  phase?: "up",
) => Promise<void>;

async function checkArrowRight(
  element: HTMLElement,
  target: string,
  pressRight: () => Promise<void>,
  releaseRight?: () => Promise<void>,
  desktop?: { trace: string[]; settle: boolean },
) {
  element.scrollIntoView({ block: "center" });
  element.focus();
  if (document.activeElement !== element || element.scrollLeft !== 0)
    throw Error("Scrollable block did not receive initial focus");
  const observed: string[] = [];
  const started = performance.now();
  const record = (stage: string) => {
    desktop?.trace.push(
      `${Math.round(performance.now() - started)}ms ${stage}`,
    );
  };
  let keydown: KeyboardEvent | undefined;
  let keyup = false;
  let defaultObserved = false;
  let lastScrollEnd: Event | undefined;
  let wakeScrollEnd: (() => void) | undefined;
  let defaultActionObserved!: () => void;
  let bothPhasesObserved!: () => void;
  const readyToRelease = new Promise<void>((resolve) => {
    defaultActionObserved = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    bothPhasesObserved = resolve;
  });
  const acknowledgeDefaultAction = () => {
    if (!keydown || (!keydown.defaultPrevented && element.scrollLeft === 0))
      return;
    if (!defaultObserved) {
      defaultObserved = true;
      record(
        keydown.defaultPrevented ? "dom-default-prevented" : "dom-scrolled",
      );
    }
    defaultActionObserved();
    if (keyup) bothPhasesObserved();
  };
  const observeScroll = (event: Event) => {
    if (lastScrollEnd && event.isTrusted && event.target === element) {
      lastScrollEnd = undefined;
      record("dom-scroll-resumed");
    }
    acknowledgeDefaultAction();
  };
  const observeScrollEnd = (event: Event) => {
    if (
      event.isTrusted &&
      event.target === element &&
      keydown &&
      !keydown.defaultPrevented &&
      defaultObserved &&
      document.activeElement === element &&
      element.scrollLeft > 0
    ) {
      lastScrollEnd = event;
      record("dom-scrollend");
      wakeScrollEnd?.();
    }
  };
  const observeRight = (event: KeyboardEvent) => {
    const tag =
      event.target instanceof Element ? event.target.tagName : "window";
    observed.push(`${event.type}/${event.code}/${tag}`);
    if (
      event.key === "ArrowRight" &&
      event.isTrusted &&
      event.target === element
    ) {
      if (event.type === "keydown") keydown = event;
      else if (keydown) keyup = true;
      record(`dom-trusted-${event.type}`);
      acknowledgeDefaultAction();
    }
  };
  window.addEventListener("keydown", observeRight, true);
  window.addEventListener("keyup", observeRight, true);
  element.addEventListener("scroll", observeScroll);
  if (desktop?.settle) element.addEventListener("scrollend", observeScrollEnd);
  window.addEventListener("keydown", acknowledgeDefaultAction);
  try {
    record("press-request");
    await pressRight();
    record("press-response");
    const deadline = performance.now() + 2500;
    if (releaseRight) {
      // AppKit can acknowledge keydown while WebContent is still running its
      // handlers. A timed release can reach WebContent before it scrolls a frame.
      try {
        await fixtureDeadline(
          `${target} keyboard scroll`,
          () => readyToRelease,
          2500,
        );
        record("scroll-gate-resolved");
      } catch (cause) {
        record(`scroll-gate-rejected: ${String(cause)}`);
        throw cause;
      } finally {
        record("release-request");
        await releaseRight();
        record("release-response");
      }
    }
    await fixtureDeadline(
      `${target} keyboard completion`,
      () => completed,
      Math.max(0, deadline - performance.now()),
    );
    if (
      element.scrollLeft <= 0 ||
      keydown?.defaultPrevented ||
      document.activeElement !== element
    )
      throw Error("The trusted key press did not scroll the focused element");
    if (desktop?.settle) {
      // Keep the code focused until its last scroll ends. A new scroll can
      // invalidate an end observed while waiting for the keyup or its reply.
      await fixtureDeadline(
        `${target} keyboard scrollend`,
        async () => {
          let end: Event;
          do {
            while (!lastScrollEnd)
              await new Promise<void>((resolve) => {
                wakeScrollEnd = resolve;
              });
            end = lastScrollEnd;
            // Drain the rendering steps that can deliver a newly queued scroll.
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            );
          } while (lastScrollEnd !== end);
        },
        Math.max(0, deadline - performance.now()),
      );
    }
  } catch (cause) {
    throw Error(
      `${target} after native ArrowRight: events=${observed.join(",")} scroll=${element.scrollLeft} focus=${document.activeElement === element} prevented=${keydown?.defaultPrevented} overflow=${element.clientWidth}/${element.scrollWidth} visibility=${document.visibilityState}. ${String(cause)}`,
      { cause },
    );
  } finally {
    window.removeEventListener("keydown", observeRight, true);
    window.removeEventListener("keyup", observeRight, true);
    element.removeEventListener("scroll", observeScroll);
    if (desktop?.settle)
      element.removeEventListener("scrollend", observeScrollEnd);
    window.removeEventListener("keydown", acknowledgeDefaultAction);
  }
}

async function checkDesktopArrow(
  element: HTMLElement,
  kind: "code" | "table",
  width: number,
  pressRight: PressRight,
) {
  const trace: string[] = [];
  try {
    await fixtureStep(`scroll-formatting-${kind}`, () =>
      checkArrowRight(
        element,
        `${kind}-${width}`,
        () => pressRight(kind, width),
        () => pressRight(kind, width, "up"),
        { trace, settle: kind === "code" },
      ),
    );
  } catch (cause) {
    // The outer fixture deadline can win before the key operation rejects.
    throw Error(`${String(cause)} [${kind}-${width}: ${trace.join(", ")}]`, {
      cause,
    });
  }
}

type Swipe = (
  axis: "preview" | "horizontal" | "vertical",
  coordinates: [number, number, number, number],
) => Promise<void>;

async function checkTableSwipe(
  target: HTMLElement,
  axis: Parameters<Swipe>[0],
  swipe: Swipe,
  moves: () => boolean,
) {
  const bounds = target.getBoundingClientRect();
  const left = Math.max(0, bounds.left);
  const right = Math.min(window.innerWidth, bounds.right);
  const top = Math.max(0, bounds.top);
  const bottom = Math.min(window.innerHeight, bounds.bottom);
  const x = (left + right) / 2;
  const y = (top + bottom) / 2;
  const dx = (right - left) / 4;
  const dy = (bottom - top) / 4;
  // Android system bars can receive touch over the edges of an edge-to-edge WebView.
  const coordinates =
    axis === "horizontal"
      ? [x + dx, y, x - dx, y]
      : axis === "vertical"
        ? [x, y + dy, x, y - dy]
        : [x, y, x, top + 16];
  if (
    Math.hypot(
      coordinates[0] - coordinates[2],
      coordinates[1] - coordinates[3],
    ) < 28
  )
    throw Error(`No visible touch path across the ${axis} table`);
  const scale = window.devicePixelRatio;
  const requested = coordinates.map((value) => Math.round(value * scale)) as [
    number,
    number,
    number,
    number,
  ];
  const phases = [
    "touchstart",
    "touchmove",
    "touchend",
    "touchcancel",
  ] as const;
  const path: string[] = [];
  const feed = target.closest<HTMLElement>(".timeline-scroll");
  const feedStart = feed?.scrollTop;
  let started = false;
  let ended = false;
  const observe = (event: TouchEvent) => {
    if (!event.isTrusted) return;
    const touch = event.changedTouches[0];
    path.push(`${event.type}(${touch?.clientX},${touch?.clientY})`);
    if (event.type === "touchstart") started = true;
    if (event.type === "touchend") ended = started;
  };
  for (const phase of phases)
    target.addEventListener(phase, observe, { passive: true });
  try {
    await swipe(axis, requested);
    await waitFor(() => {
      if (!ended || !moves())
        throw Error(
          `Table ${axis} touch: offsets=${target.scrollLeft},${target.scrollTop}, area=${target.clientWidth}×${target.clientHeight}/${target.scrollWidth}×${target.scrollHeight}, requested=${requested} at ${scale}x, path=${path.join(" ")}${feed ? `, feed scrollTop=${feedStart}→${feed.scrollTop}` : ""}`,
        );
    });
  } finally {
    for (const phase of phases) target.removeEventListener(phase, observe);
  }
}

async function checkTableAxes(table: HTMLElement, swipe: Swipe) {
  if (table.scrollLeft !== 0 || table.scrollTop !== 0)
    throw Error(
      `Table gesture at ${innerWidth}px did not start at the origin: ${table.scrollLeft},${table.scrollTop}`,
    );
  const movedRight = () => table.scrollLeft >= 15;
  await checkTableSwipe(table, "horizontal", swipe, movedRight);
  await checkTableSwipe(
    table,
    "vertical",
    swipe,
    () => movedRight() && table.scrollTop >= 15,
  );
}

async function checkCellPress(
  cell: HTMLElement,
  press: (x: number, y: number) => Promise<void>,
  expected: string,
) {
  const range = document.createRange();
  range.selectNodeContents(cell);
  const bounds = range.getBoundingClientRect();
  const x = Math.round((bounds.left + bounds.width / 2) * devicePixelRatio);
  const y = Math.round((bounds.top + bounds.height / 2) * devicePixelRatio);
  const events = ["touchstart", "touchend", "touchcancel"] as const;
  const phases = new Set<string>();
  const observe = (event: TouchEvent) => {
    if (event.isTrusted) phases.add(event.type);
  };
  for (const type of events)
    cell.addEventListener(type, observe, { passive: true });
  try {
    await press(x, y);
    await waitFor(() => {
      const selected = document.getSelection()?.toString();
      if (
        !phases.has("touchstart") ||
        !(phases.has("touchend") || phases.has("touchcancel")) ||
        selected !== expected
      )
        throw Error(
          `Long press at ${x},${y}: phases=${[...phases]}, selected=${selected}, expected=${expected}`,
        );
    });
  } finally {
    for (const type of events) cell.removeEventListener(type, observe);
  }
}

async function waitForTableSelection(table: HTMLElement, allowed: boolean) {
  await waitFor(() => {
    const selectable = getComputedStyle(table).userSelect === "text";
    if (
      selectable !== allowed ||
      (!allowed && document.getSelection()?.toString())
    )
      throw Error(
        `Table text selection: allowed=${selectable}, expected=${allowed}, selected=${document.getSelection()?.toString()}`,
      );
  });
}

function FormattingWorkspace({ children }: { children: ReactNode }) {
  const tables = usePublishedReaderWindow("formatting", "# Formatting");
  useWorkspaceBack(Boolean(tables.opening), null);
  return (
    <PublishedReaderWindow value={tables.value}>
      {children}
      <PublishedTableScreen reader={tables} />
      <PublishedCodeReader reader={tables} />
    </PublishedReaderWindow>
  );
}

function checkPreviewCorner(preview: HTMLElement, readable?: HTMLElement) {
  const area = preview.querySelector(".post-table-preview-grid");
  const button = within(preview).getByRole("button", { name: /^Open table:/ });
  const icon = button.querySelector("svg");
  if (!area || !icon) throw Error("The table preview has no expansion control");
  const frame = preview.getBoundingClientRect();
  const grid = area.getBoundingClientRect();
  const hit = button.getBoundingClientRect();
  const mark = icon.getBoundingClientRect();
  const rtl = getComputedStyle(preview).direction === "rtl";
  const inset = rtl ? mark.left - grid.left : grid.right - mark.right;
  if (
    Math.abs(grid.width - frame.width) > 1 ||
    Math.abs(hit.width - frame.width) > 1 ||
    Math.abs(hit.height - frame.height) > 1 ||
    Math.abs(inset - 2) > 1 ||
    Math.abs(grid.bottom - mark.bottom - 2) > 1 ||
    mark.top < grid.top ||
    Math.abs(mark.width - 31) > 1 ||
    Math.abs(mark.height - 31) > 1
  )
    throw Error(
      `The expansion icon left its table corner: frame=${frame.width}x${frame.height}, grid=${grid.width}x${grid.height}, icon=${mark.width}x${mark.height}, inset=${inset}`,
    );
  if (readable) {
    const range = document.createRange();
    range.selectNodeContents(readable);
    const text = range.getBoundingClientRect();
    if (rtl ? text.left < mark.right : text.right > mark.left)
      throw Error("The expansion icon covers the corner cell text");
  }
}

async function checkMobileTable(
  table: HTMLElement | null,
  fittingTable: HTMLElement | null,
  tallTable: HTMLElement | null,
  pressRight: () => Promise<void>,
  physical?: {
    swipe: Swipe;
    rotate: (orientation: "landscape" | "portrait") => Promise<void>;
    longPress: (x: number, y: number) => Promise<void>;
    allowSelection: (allowed: boolean) => Promise<void>;
  },
) {
  if (!table || !fittingTable || !tallTable)
    throw Error("Missing compact tables");
  const verifyPreview = () => {
    const limit = Math.floor(innerWidth / 96);
    if (
      table.querySelectorAll("tr").length !== limit ||
      table.querySelectorAll("thead th").length !== 3 ||
      table.querySelectorAll("tbody tr:first-child td").length !==
        Math.min(limit, 4) ||
      table.querySelectorAll("tbody tr:last-child td:first-child")[0]
        ?.textContent !== `Row ${limit - 3}` ||
      !table.hasAttribute("data-more-rows") ||
      getComputedStyle(table).overflow !== "clip"
    )
      throw Error(`Table preview did not recalculate at ${innerWidth}px`);
  };
  verifyPreview();
  if (
    fittingTable.hasAttribute("data-more-rows") ||
    fittingTable.hasAttribute("data-more-columns") ||
    table.clientHeight > 300
  )
    throw Error("Unexpected fitting-table fade or preview height");

  const button = within(table).getByRole("button", {
    name: `Open table: ${lastRow + 3} rows, 10 columns`,
  });
  const short = within(fittingTable).getByRole("button", {
    name: "Open table: 2 rows, 1 column",
  });
  const shortCell = within(fittingTable).getByRole("cell", { name: "Fits" });
  checkPreviewCorner(table);
  checkPreviewCorner(tallTable);
  checkPreviewCorner(fittingTable, shortCell);
  fittingTable.dir = "rtl";
  try {
    checkPreviewCorner(fittingTable, shortCell);
  } finally {
    fittingTable.removeAttribute("dir");
  }
  if (physical) {
    const feed = table.closest<HTMLElement>(".timeline-scroll");
    if (
      !feed ||
      tallTable.clientHeight !== 300 ||
      !tallTable.hasAttribute("data-more-rows") ||
      tallTable.hasAttribute("data-more-columns")
    )
      throw Error(
        "A wrapping cell must clip at exactly 300px and fade only at the bottom",
      );
    tallTable.scrollIntoView({ block: "center" });
    const origin = feed.scrollTop;
    await checkTableSwipe(
      tallTable,
      "preview",
      physical.swipe,
      () => feed.scrollTop > origin + 15 && tallTable.scrollTop === 0,
    );
  }
  table.scrollIntoView({ block: "center" });
  button.focus({ preventScroll: true });
  const openTable = () => {
    flushSync(() => fireEvent.click(button));
    return within(document.body).getByRole("dialog", { name: "Table" });
  };
  async function closeTable(dialog: HTMLElement) {
    const back = within(dialog).getByRole("button", { name: "Back" });
    flushSync(() => fireEvent.click(back));
    await waitFor(() => {
      if (dialog.isConnected || document.activeElement !== button)
        throw Error("The full screen did not restore its exact opener");
    });
  }
  const scrollRegion = (dialog: HTMLElement) =>
    within(dialog).getByRole("region", { name: "Table" });
  if (physical) {
    // ArrowRight can keep scrolling on the compositor after keyup and a
    // scrollLeft reset. Give touch a newly mounted scroll area.
    const keyboardDialog = openTable();
    await checkArrowRight(
      scrollRegion(keyboardDialog),
      "full table",
      pressRight,
    );
    await closeTable(keyboardDialog);
  }
  const dialog = openTable();
  const ui = within(dialog);
  const full = scrollRegion(dialog);
  const caption = ui.getByText("Ada · # Formatting");
  const header = ui.getByRole("columnheader", { name: "Score" });
  const last = ui.getByRole("cell", { name: "Last cell" });
  const first = ui.getByRole("cell", { name: "Aurora" });
  const dimensions = `${full.clientWidth}×${full.clientHeight}/${full.scrollWidth}×${full.scrollHeight}`;
  if (
    full.scrollWidth <= full.clientWidth ||
    full.scrollHeight <= full.clientHeight ||
    full.getBoundingClientRect().right > innerWidth ||
    ui.getAllByRole("table").length !== 1 ||
    ui.getAllByRole("row").length !== lastRow + 3 ||
    document.activeElement !== full ||
    getComputedStyle(header).textAlign !== "right" ||
    !ui.getByRole("cell", { name: "Italic" }).querySelector("em") ||
    !last.querySelector("strong") ||
    !ui.getByRole("cell", { name: /keep +spaces/ }).querySelector("code")
  )
    throw Error(
      `Full table: ${dimensions}, focus=${document.activeElement?.tagName}, rows=${ui.getAllByRole("row").length}, align=${getComputedStyle(header).textAlign}`,
    );
  await waitForTableSelection(full, true);
  if (physical) {
    await checkCellPress(first, physical.longPress, "Aurora");
    const selection = document.getSelection();
    if (!selection?.rangeCount) throw Error("Missing selected table text");
    const { endContainer, endOffset } = selection.getRangeAt(0);
    selection.setBaseAndExtent(caption, 0, endContainer, endOffset);
    const mixed = selection.toString();
    if (!mixed.includes("Ada · # Formatting") || !mixed.includes("Aurora"))
      throw Error("Could not extend the table selection to its caption");
    await physical.allowSelection(false);
    await waitForTableSelection(full, false);
    await checkCellPress(first, physical.longPress, "");
    full.scrollTo(0, 0);
    await checkTableAxes(full, physical.swipe);
  } else {
    await checkArrowRight(full, "full table", pressRight);
  }
  const range = document.createRange();
  range.selectNodeContents(last);
  const bounds = full.getBoundingClientRect();
  const stickyTop = header.getBoundingClientRect().top;
  full.scrollTo(
    full.scrollLeft + range.getBoundingClientRect().left - bounds.left - 2,
    full.scrollHeight,
  );
  const cellText = range.getBoundingClientRect();
  if (
    cellText.left < bounds.left ||
    cellText.right > bounds.right ||
    cellText.bottom > bounds.bottom ||
    cellText.top < bounds.top ||
    Math.abs(header.getBoundingClientRect().top - stickyTop) > 1 ||
    range.toString() !== "Last cell"
  )
    throw Error("Could not reach the last cell");
  if (physical) {
    full.scrollTo(0, 0);
    const origin = innerWidth;
    await physical.rotate("landscape");
    await waitFor(
      () => {
        if (innerWidth < 820 || innerWidth <= origin)
          throw Error("Android did not rotate to a tablet-width viewport");
        verifyPreview();
      },
      { timeout: 4000 },
    );
    await waitForTableSelection(full, false);
    full.scrollTo(0, 0);
    await checkTableAxes(full, physical.swipe);
    full.scrollTo(0, 0);
    await physical.rotate("portrait");
    await waitFor(
      () => {
        if (innerWidth !== origin)
          throw Error("Android did not return to portrait");
        verifyPreview();
      },
      { timeout: 4000 },
    );
    full.scrollTo(0, 0);
    await physical.allowSelection(true);
    await waitForTableSelection(full, true);
    await checkCellPress(first, physical.longPress, "Aurora");
    document.getSelection()?.removeAllRanges();
  }
  await closeTable(dialog);
  flushSync(() => fireEvent.click(short));
  const small = within(
    within(document.body).getByRole("dialog", { name: "Table" }),
  );
  const smallRegion = small.getByRole("region", { name: "Table" });
  const smallGrid = small.getByRole("table");
  if (
    !small.getByRole("cell", { name: "Fits" }) ||
    small.queryByText("Last cell") ||
    Math.abs(
      smallGrid.getBoundingClientRect().width - smallRegion.clientWidth,
    ) > 1 ||
    smallRegion.clientWidth >= innerWidth - 24
  )
    throw Error("Opening a second table showed a previous selection");
  flushSync(() => fireEvent.click(small.getByRole("button", { name: "Back" })));
}

type CodeInput = {
  tap: (
    phase: "preview" | "copy",
    coordinates: [number, number],
  ) => Promise<void>;
  back: () => Promise<void>;
  rotateCode: (orientation: "landscape" | "portrait") => Promise<void>;
};

async function checkCopyCode(scope: HTMLElement, source: string) {
  const button = await within(scope).findByRole("button", {
    name: "Copy code",
  });
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  let copied: string | undefined;
  // Record this fixture's write without touching the user's desktop clipboard.
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        copied = value;
      },
    },
  });
  try {
    flushSync(() => button.click());
    await within(scope).findByText("Code copied.");
    if (copied !== source)
      throw Error("The clipboard did not receive the exact code source");
  } finally {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
}

async function tapCodeControl(
  control: HTMLElement,
  phase: "preview" | "copy",
  tap: CodeInput["tap"],
) {
  let trusted = false;
  const observe = (event: MouseEvent) => {
    trusted = event.isTrusted;
  };
  control.addEventListener("click", observe, { once: true });
  const bounds = control.getBoundingClientRect();
  const scale = devicePixelRatio / 2;
  try {
    await tap(phase, [
      Math.round(
        (Math.max(0, bounds.left) + Math.min(innerWidth, bounds.right)) * scale,
      ),
      Math.round(
        (Math.max(0, bounds.top) + Math.min(innerHeight, bounds.bottom)) *
          scale,
      ),
    ]);
    await waitFor(() => {
      if (!trusted)
        throw Error(`Code ${phase} did not receive a trusted Android tap`);
    });
  } finally {
    control.removeEventListener("click", observe);
  }
}

async function checkMobileCode(
  host: HTMLElement,
  width: number,
  pressRight: () => Promise<void>,
  physical?: CodeInput,
) {
  const trigger = Array.from(
    host.querySelectorAll<HTMLButtonElement>(".post-code-preview"),
  ).find(
    (button) =>
      button.querySelector("code")?.textContent === longCode &&
      (!physical ||
        button.closest("[data-post-id]")?.getAttribute("data-post-id") ===
          "rotate-code"),
  );
  if (
    !trigger ||
    !within(host).getAllByRole("button", { name: "Open code: 1 line" }).length
  )
    throw Error("Missing mobile code trigger");
  const pane = trigger.closest(".timeline-scroll");
  if (!pane) throw Error("Missing code timeline");
  trigger.scrollIntoView({ block: "center" });
  let position = pane.scrollTop;
  if (physical) {
    await tapCodeControl(trigger, "preview", physical.tap);
  } else {
    flushSync(() => trigger.click());
  }
  const dialog = await within(host).findByRole("dialog", { name: "Code" });
  const panel = within(dialog);
  const region = panel.getByRole("region", { name: "Full code, 1 line" });
  if (
    document.activeElement !== region ||
    region.querySelector("pre code")?.textContent !== longCode ||
    panel.getByText("Ada · # Formatting") === null
  )
    throw Error("Wrong full code or initial reading focus");
  await checkArrowRight(region, `code-${width}`, pressRight);
  if (physical) {
    const copy = await panel.findByRole("button", { name: "Copy code" });
    await tapCodeControl(copy, "copy", physical.tap);
    await waitFor(() => {
      const status = panel.getByRole("status").textContent;
      if (status !== "Code copied.")
        throw Error(`Android system clipboard: ${status}`);
    });
  }
  await checkCopyCode(dialog, longCode);
  let returnTarget: HTMLElement = trigger;
  const backState = () => {
    const compact = (n: number) => Math.round(n * 100) / 100;
    const bounds = (node: Element) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return [x, y, width, height].map(compact);
    };
    const identify = (node: Element | null) =>
      node && `${node.localName}.${node.getAttribute("class") ?? ""}`;
    const { activeElement, documentElement } = document;
    const windowViewport = window.visualViewport;
    return {
      connected: dialog.isConnected,
      open: dialog.matches("[open]"),
      focused: activeElement === returnTarget,
      active: identify(activeElement),
      target: identify(returnTarget),
      expanded: returnTarget.getAttribute("aria-expanded"),
      openerClipped: trigger.hasAttribute("data-post-disclosure-clipped"),
      openerInert: trigger.inert,
      targetClipped: returnTarget.hasAttribute("data-post-disclosure-clipped"),
      targetInert: returnTarget.inert,
      scroll: [pane.scrollLeft, pane.scrollTop].map(compact),
      paneBox: bounds(pane),
      openerBox: bounds(trigger),
      targetBox: bounds(returnTarget),
      viewport: [
        innerWidth,
        innerHeight,
        documentElement.clientWidth,
        documentElement.clientHeight,
      ],
      visualViewport: windowViewport
        ? [
            windowViewport.offsetLeft,
            windowViewport.offsetTop,
            windowViewport.width,
            windowViewport.height,
          ].map(compact)
        : null,
    };
  };
  if (physical) {
    const disclosure = trigger
      .closest("[data-post-id]")
      ?.querySelector<HTMLButtonElement>(".post-body-disclosure-action");
    if (
      disclosure?.getAttribute("aria-expanded") !== "false" ||
      trigger.hasAttribute("inert")
    )
      throw Error("The code must initially be reachable in a folded post");
    await physical.rotateCode("landscape");
    await waitFor(() => {
      if (!trigger.hasAttribute("data-post-disclosure-clipped"))
        throw Error("Landscape did not clip the code opener");
    });
    returnTarget = disclosure;
    position = pane.scrollTop;
  }
  // The rotated layout is sampled synchronously before sending Back.
  const before = backState();
  if (physical) await physical.back();
  else flushSync(() => panel.getByRole("button", { name: "Back" }).click());
  try {
    await waitFor(() => {
      if (
        dialog.isConnected ||
        document.activeElement !== returnTarget ||
        (physical && returnTarget.getAttribute("aria-expanded") !== "false") ||
        Math.abs(pane.scrollTop - position) > 1
      )
        throw Error("Back lost the available post action or reading position");
    });
  } catch (cause) {
    const after = backState();
    throw Error(
      `Code reader Back expected scrollTop=${position} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
      { cause },
    );
  }
  if (physical) await physical.rotateCode("portrait");
}

function codeBackGeometry(host: HTMLElement) {
  const post = host.querySelector('[data-post-id="rotate-code"]');
  const opener = post?.querySelector<HTMLButtonElement>(".post-code-preview");
  const action = post?.querySelector<HTMLButtonElement>(
    ".post-body-disclosure-action",
  );
  const pane = post?.closest(".timeline-scroll");
  const dialog = host.querySelector("dialog.post-code-reader");
  const active = document.activeElement;
  const visual = window.visualViewport;
  const round = (value: number) => Math.round(value * 100) / 100;
  const box = (node: Element | null | undefined) => {
    if (!node) return null;
    const { left, top, right, bottom } = node.getBoundingClientRect();
    return [left, top, right, bottom].map(round);
  };
  const paneBox = box(pane);
  const actionBox = box(action);
  return {
    size: [
      innerWidth,
      innerHeight,
      document.documentElement.clientWidth,
      document.documentElement.clientHeight,
    ],
    visual: visual
      ? [
          visual.offsetLeft,
          visual.offsetTop,
          visual.width,
          visual.height,
          visual.scale,
        ].map(round)
      : null,
    windowScroll: [scrollX, scrollY].map(round),
    pane: paneBox,
    scrollTop: pane ? round(pane.scrollTop) : null,
    scrollHeight: pane?.scrollHeight,
    opener: box(opener),
    clipped: opener?.hasAttribute("data-post-disclosure-clipped"),
    openerInert: opener?.inert,
    action: actionBox,
    actionInPane:
      actionBox &&
      paneBox &&
      actionBox[0] >= paneBox[0] &&
      actionBox[1] >= paneBox[1] &&
      actionBox[2] <= paneBox[2] &&
      actionBox[3] <= paneBox[3],
    actionInert: action?.inert,
    expanded: action?.getAttribute("aria-expanded"),
    dialog: dialog
      ? dialog.hasAttribute("open")
        ? "open"
        : "closed"
      : "removed",
    active:
      active && `${active.localName}.${active.getAttribute("class") ?? ""}`,
    focusedAction: active === action,
    documentFocused: document.hasFocus(),
  };
}

async function checkNativeCodeBack(
  host: HTMLElement,
  width: number,
  pressRight: () => Promise<void>,
  input: CodeInput,
) {
  type Geometry = ReturnType<typeof codeBackGeometry>;
  let portrait: Geometry | undefined;
  let landscape: Geometry | undefined;
  let stage = "before rotation";
  try {
    await checkMobileCode(host, width, pressRight, {
      ...input,
      async rotateCode(orientation) {
        stage = `rotate ${orientation}`;
        if (orientation === "landscape") portrait = codeBackGeometry(host);
        await input.rotateCode(orientation);
        stage = "verify clipped opener";
      },
      async back() {
        stage = "send Back";
        landscape = codeBackGeometry(host);
        await input.back();
        stage = "verify return";
      },
    });
  } catch (cause) {
    if (!portrait) throw cause;
    const reason =
      cause instanceof Error
        ? cause.cause instanceof Error
          ? cause.cause.message
          : cause.message
        : String(cause);
    throw Error(
      `Android code Back (${stage}, tolerance=1 CSS px): ${reason.split("\n", 1)[0]}; ` +
        `portrait=${JSON.stringify(portrait)} landscape=${JSON.stringify(landscape)} after=${JSON.stringify(codeBackGeometry(host))}`,
      { cause },
    );
  }
}

export async function checkChannelFormatting(
  pressRight: PressRight,
  mobile?: NonNullable<Parameters<typeof checkMobileTable>[4]> & CodeInput,
  widths: readonly number[] = [320, 820],
) {
  const author = () => ({ name: "Ada" });
  const posts: LocalChannelWindow["posts"] = Array.from(
    { length: 60 },
    (_, i) => ({
      id: String(60 - i),
      channelId: "formatted",
      rootId: null,
      userId: "ada",
      createAt: 1000 + i,
      updateAt: 1000 + i,
      editAt: 0,
      isPinned: false,
      type: "",
      hashtags: "",
      message: bodies[i % bodies.length],
      messageSource: "Original for editing",
    }),
  );
  if (isAndroid && mobile) {
    const prior = Array.from(
      { length: 14 },
      (_, line) => `- Reading line ${line + 1}`,
    ).join("\n");
    const after = Array.from(
      { length: 25 },
      (_, line) => `- Continuing reading ${line + 1}`,
    ).join("\n");
    posts[3] = {
      ...posts[3],
      id: "rotate-code",
      message: `${prior}\n\n${bodies[3]}\n\n${after}`,
    };
  }
  const results = [];
  for (const width of widths) {
    const host = document.createElement("div");
    host.style.width = `${width}px`;
    host.style.height = "420px";
    const mode = width === 320 ? "dark" : "light";
    applyPalette(host, mode, resolvePalette(mode));
    document.body.append(host);
    const root = createRoot(host);
    const draw = () => {
      const start = performance.now();
      flushSync(() =>
        root.render(
          <FormattingWorkspace>
            <ChannelTimeline
              channelId="formatted"
              locale="en"
              author={author}
              offline={false}
              page={{
                posts: [...posts],
                older: { kind: "end" },
                newer: { kind: "end" },
                firstInaccessiblePostTime: 0,
              }}
            />
          </FormattingWorkspace>,
        ),
      );
      const pane = host.querySelector<HTMLElement>(".timeline-scroll");
      if (
        !pane ||
        pane.scrollWidth > pane.clientWidth + 1 ||
        pane.scrollHeight <= pane.clientHeight
      )
        throw Error("formatted page width or height");
      return performance.now() - start;
    };
    try {
      const first = draw(),
        unchanged = draw();
      const heading = host.querySelector<HTMLElement>(".published-post h1");
      const secondHeading = heading?.nextElementSibling;
      if (!(secondHeading instanceof HTMLElement) || !heading)
        throw Error("Missing adjacent Markdown headings");
      const gap =
        secondHeading.getBoundingClientRect().top -
        heading.getBoundingClientRect().bottom;
      const expectedGap =
        0.48 * Number.parseFloat(getComputedStyle(secondHeading).fontSize);
      if (Math.abs(gap - expectedGap) > 1)
        throw Error("Published Markdown headings lost their block spacing");
      const task = host.querySelector<HTMLInputElement>(
        ".published-post input",
      );
      const label = heading.parentElement?.querySelector("em");
      if (
        host.querySelectorAll("article").length !== 60 ||
        !heading ||
        heading.textContent !== "Notes" ||
        !task?.disabled ||
        !task.checked ||
        !label ||
        host.querySelector(".published-post a,.published-post img")
      )
        throw Error("formatted page semantics");
      const inline = Array.from(host.querySelectorAll("p code")).find(
        (code) => code.textContent === "const  value",
      )?.firstChild;
      if (!inline) throw Error("Missing inline code");
      const measure = (start: number, end: number) => {
        const range = document.createRange();
        range.setStart(inline, start);
        range.setEnd(inline, end);
        return range.getBoundingClientRect().width;
      };
      if (measure(5, 7) < 1.8 * measure(4, 5))
        throw Error("Inline code collapsed its repeated spaces");

      let desktopCode: HTMLPreElement | undefined;
      if (isAndroid) {
        const arrow = () => pressRight("code", width);
        if (width === 320 && mobile)
          await checkNativeCodeBack(host, width, arrow, mobile);
        else await checkMobileCode(host, width, arrow);
      } else {
        const codeBlocks = Array.from(
          host.querySelectorAll<HTMLPreElement>(".published-post pre"),
        );
        const pre = codeBlocks.find((block) => block.textContent === longCode);
        const short = codeBlocks.find(
          (block) => block.textContent === "let value;",
        );
        if (
          !pre ||
          pre.scrollWidth <= pre.clientWidth ||
          pre.tabIndex !== 0 ||
          pre.getAttribute("aria-label") !== "Code (ts)" ||
          !short ||
          short.hasAttribute("tabindex") ||
          short.hasAttribute("role")
        )
          throw Error("Wrong desktop code keyboard targets");
        const code = pre.closest<HTMLElement>(".post-code-desktop");
        if (!code) throw Error("Missing desktop code copy");
        const source = pre.querySelector("code")?.firstChild;
        if (!source) throw Error("Missing desktop code source");
        pre.scrollLeft = pre.scrollWidth;
        const end = document.createRange();
        end.setStart(source, longCode.length - 3);
        end.setEnd(source, longCode.length);
        const text = end.getBoundingClientRect();
        const button = within(code).getByRole("button", { name: "Copy code" });
        if (
          text.left < pre.getBoundingClientRect().left ||
          text.right > button.getBoundingClientRect().left
        )
          throw Error("Copy covers the end of the first code line");
        await checkCopyCode(code, longCode);
        pre.scrollLeft = 0;
        desktopCode = pre;
      }

      function checkEmphasisSelection(node: HTMLElement) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        if (selection?.toString() !== "emphasis")
          throw Error("formatted text selection");
        selection.removeAllRanges();
        return { range, selection };
      }

      const tableIn = (index: number) =>
        host.querySelector<HTMLElement>(
          `[data-post-id="${posts[index].id}"] .post-table`,
        );
      const table = tableIn(7);
      const fittingTable = tableIn(8);
      if (isAndroid) {
        checkEmphasisSelection(label);
        const headingTable = tableIn(12);
        if (!headingTable) throw Error("Missing heading-only table preview");
        checkPreviewCorner(
          headingTable,
          within(headingTable).getByRole("columnheader", {
            name: "Header only",
          }),
        );
        await checkMobileTable(
          table,
          fittingTable,
          tableIn(11),
          () => pressRight("table", width),
          width === 320 ? mobile : undefined,
        );
      } else {
        const headers = [...(table?.querySelectorAll("th[scope=col]") ?? [])];
        const row = [
          ...(table?.querySelectorAll("tbody tr:first-child td") ?? []),
        ];
        if (
          table?.getAttribute("role") !== "region" ||
          table.getAttribute("aria-label") !== "Table" ||
          table.scrollWidth <= table.clientWidth ||
          headers.map((cell) => cell.textContent).join(",") !==
            "Name,Status,Score" ||
          getComputedStyle(headers[1]).textAlign !== "center" ||
          getComputedStyle(headers[2]).textAlign !== "right" ||
          row.length !== 4 ||
          row[0]?.querySelector("strong")?.textContent !== "Aurora" ||
          row[2]?.textContent !== "17" ||
          row[3]?.textContent !== extraCell
        )
          throw Error("Table headings, alignment, overflow or authored cells");
        if (
          !fittingTable ||
          fittingTable.hasAttribute("tabindex") ||
          fittingTable.hasAttribute("role")
        )
          throw Error("A fitting table added a keyboard stop");
        // Verify the neighboring render before starting a keyboard scroll.
        table.scrollLeft = 100;
        const offset = table.scrollLeft;
        if (offset <= 1)
          throw Error(`Could not set the table scroll offset at ${width}px`);
        const neighbor = posts[6];
        posts[6] = { ...neighbor, message: `${neighbor.message}!` };
        draw();
        posts[6] = neighbor;
        if (table !== tableIn(7))
          throw Error(`The neighboring edit replaced the table at ${width}px`);
        if (Math.abs(table.scrollLeft - offset) > 1)
          throw Error(
            `The neighboring edit moved the table at ${width}px from ${offset} to ${table.scrollLeft}`,
          );
        table.scrollLeft = 0;
        const { range, selection } = checkEmphasisSelection(label);
        range.selectNodeContents(row[3]);
        selection.addRange(range);
        if (selection.toString() !== row[3].textContent)
          throw Error("Table cell text could not be selected");
        selection.removeAllRanges();
      }
      const latest = posts.at(-1);
      if (!latest) throw Error("Missing formatting fixture post");
      posts.push({
        ...latest,
        id: "disclosure",
        createAt: latest.createAt + 1,
        updateAt: latest.updateAt + 1,
        message: Array.from(
          { length: 80 },
          (_, line) => `- Synthetic reading line ${line + 1}`,
        ).join("\n"),
      });
      try {
        draw();
        checkDisclosure(host, width);
      } finally {
        posts.pop();
      }
      // Finish DOM updates and programmatic scrolls before testing AppKit's
      // default action. WebKit can keep animating after keyup.
      if (!isAndroid) {
        if (!desktopCode || !table)
          throw Error("Missing desktop scroll targets");
        await checkDesktopArrow(desktopCode, "code", width, pressRight);
        await checkDesktopArrow(table, "table", width, pressRight);
      }
      results.push({ width, first, unchanged });
    } finally {
      root.unmount();
      host.remove();
    }
  }
  return results;
}

export async function checkPublishedLinkKey(pressEnter: () => Promise<void>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const href = "https://example.test/handbook";
  const activations: { href: string; origin: HTMLAnchorElement }[] = [];
  try {
    flushSync(() =>
      root.render(
        <PublishedLinkNavigation.Provider
          value={{
            serverUrl: "https://example.test",
            open: (href, origin) => activations.push({ href, origin }),
          }}
        >
          <PublishedPostBody
            message="[**Handbook**](/handbook)"
            locale="en"
            authorName="Ada"
          />
        </PublishedLinkNavigation.Provider>,
      ),
    );
    const link = within(host).getByRole("link", { name: "Handbook" });
    let trusted = false;
    link.addEventListener("click", (event) => {
      trusted = event.isTrusted;
    });
    link.focus();
    await pressEnter();
    await waitFor(() => {
      if (
        !trusted ||
        activations.length !== 1 ||
        activations[0].href !== href ||
        activations[0].origin !== link
      )
        throw Error(
          `Trusted Enter did not activate the styled link exactly once: ${trusted}, ${activations.length}`,
        );
    });
  } finally {
    root.unmount();
    host.remove();
  }
}
