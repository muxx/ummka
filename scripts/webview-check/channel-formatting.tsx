import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyPalette, resolvePalette } from "../../src/appearance/palette.ts";
import { isAndroid } from "../../src/build-platform.ts";
import { ChannelTimeline } from "../../src/channels/ChannelTimeline.tsx";
import type { LocalChannelWindow } from "../../src/mattermost/local-history.ts";

const longCode = `  const summary = "${"a".repeat(320)}";`;
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
    `| **Aurora** | Ready | 17 | ${"wide".repeat(70)} |`,
    ...Array.from({ length: 6 }, (_, i) => `| Row ${i} | In progress | ${i} |`),
  ].join("\n"),
  "| Short |\n| --- |\n| Fits |",
  "A short inline `const  value` with an ampersand &amp; text.",
  "A paragraph with ordinary readable text.\n\n~~~\nlet value;\n~~~",
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

async function checkArrowRight(
  element: HTMLElement,
  target: string,
  pressRight: () => Promise<void>,
) {
  element.scrollIntoView({ block: "center" });
  element.focus();
  if (document.activeElement !== element || element.scrollLeft !== 0)
    throw Error("Scrollable block did not receive initial focus");
  const phases = new Set<string>();
  const observed: string[] = [];
  const observeRight = (event: KeyboardEvent) => {
    const tag =
      event.target instanceof Element ? event.target.tagName : "window";
    observed.push(`${event.type}/${event.code}/${tag}`);
    if (
      event.key === "ArrowRight" &&
      event.isTrusted &&
      event.target === element
    )
      phases.add(event.type);
  };
  window.addEventListener("keydown", observeRight, true);
  window.addEventListener("keyup", observeRight, true);
  try {
    await pressRight();
    // Keep the focused block mounted until both halves of the
    // physical press arrive, including the release after native scrolling.
    const deadline = performance.now() + 2500;
    while (
      (phases.size < 2 || element.scrollLeft === 0) &&
      performance.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (
      phases.size !== 2 ||
      element.scrollLeft <= 0 ||
      document.activeElement !== element
    )
      throw Error(
        `${target} after native ArrowRight: events=${observed.join(",")} scroll=${element.scrollLeft} focus=${document.activeElement === element}`,
      );
  } finally {
    window.removeEventListener("keydown", observeRight, true);
    window.removeEventListener("keyup", observeRight, true);
  }
}

async function checkTableSwipe(
  table: HTMLElement,
  swipe: (from: number, to: number, y: number) => Promise<void>,
) {
  table.scrollLeft = 0;
  table.scrollIntoView({ block: "center" });
  const bounds = table.getBoundingClientRect();
  const left = Math.max(0, bounds.left);
  const right = Math.min(window.innerWidth, bounds.right);
  const top = Math.max(0, bounds.top);
  const bottom = Math.min(window.innerHeight, bounds.bottom);
  if (right - left < 100 || top >= bottom)
    throw Error("No visible touch path across the table");
  const scale = window.devicePixelRatio;
  let touched = false;
  const observe = (event: TouchEvent) => {
    if (event.isTrusted) touched = true;
  };
  table.addEventListener("touchstart", observe, { passive: true });
  try {
    await swipe(
      Math.round((right - 16) * scale),
      Math.round((left + 16) * scale),
      Math.round(((top + bottom) / 2) * scale),
    );
    const deadline = performance.now() + 2500;
    while ((!touched || table.scrollLeft < 15) && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (!touched || table.scrollLeft < 15)
      throw Error(
        `Table touch: trusted=${touched}, scroll=${table.scrollLeft}`,
      );
  } finally {
    table.removeEventListener("touchstart", observe);
  }
}

export async function checkChannelFormatting(
  pressRight: (kind: "code" | "table", width: number) => Promise<void>,
  swipe?: (from: number, to: number, y: number) => Promise<void>,
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
  const results = [];
  for (const width of [320, 820]) {
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
          />,
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
      const codeBlocks = [
        ...host.querySelectorAll<HTMLPreElement>(".published-post pre"),
      ];
      const pre = codeBlocks.find((code) => code.textContent === longCode);
      const shortCode = codeBlocks.find(
        (code) => code.textContent === "let value;",
      );
      if (
        !shortCode ||
        shortCode.hasAttribute("tabindex") ||
        shortCode.hasAttribute("role")
      )
        throw Error("short code adds a keyboard stop");
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
      const label = host.querySelector<HTMLElement>(".published-post em");
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
      if (
        !pre ||
        pre.scrollWidth <= pre.clientWidth ||
        pre.tabIndex !== 0 ||
        pre.getAttribute("aria-label") !== "Code (ts)"
      )
        throw Error("overflowing code is not a keyboard target");
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

      await checkArrowRight(pre, `code-${width}`, () =>
        pressRight("code", width),
      );

      const tableIn = (index: number) =>
        host.querySelector<HTMLElement>(
          `[data-post-id="${posts[index].id}"] .post-table`,
        );
      const table = tableIn(7);
      const fittingTable = tableIn(8);
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
        row[3]?.textContent !== "wide".repeat(70)
      )
        throw Error("Table headings, alignment, overflow or authored cells");
      if (
        !fittingTable ||
        fittingTable.hasAttribute("tabindex") ||
        fittingTable.hasAttribute("role")
      )
        throw Error("A fitting table added a keyboard stop");
      await checkArrowRight(table, `table-${width}`, () =>
        pressRight("table", width),
      );
      const offset = table.scrollLeft;
      table.scrollLeft = offset;
      const neighbor = posts[6];
      posts[6] = { ...neighbor, message: `${neighbor.message}!` };
      draw();
      posts[6] = neighbor;
      if (table !== tableIn(7) || Math.abs(table.scrollLeft - offset) > 1)
        throw Error(
          "The table lost its horizontal position on a neighboring edit",
        );
      if (width === 320 && swipe) await checkTableSwipe(table, swipe);

      const range = document.createRange();
      range.selectNodeContents(label);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (selection?.toString() !== "emphasis")
        throw Error("formatted text selection");
      selection.removeAllRanges();
      range.selectNodeContents(row[3]);
      selection.addRange(range);
      if (selection.toString() !== row[3].textContent)
        throw Error("Table cell text could not be selected");
      selection.removeAllRanges();
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
      results.push({ width, first, unchanged });
    } finally {
      root.unmount();
      host.remove();
    }
  }
  return results;
}
