import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyPalette, resolvePalette } from "../../src/appearance/palette.ts";
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
  "| a | b |\n| - | - |\n| c | d |",
  "A short inline `const  value` with an ampersand &amp; text.",
  "A paragraph with ordinary readable text.\n\n~~~\nlet value;\n~~~",
];

export async function checkChannelFormatting(pressRight: () => Promise<void>) {
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

      pre.scrollIntoView({ block: "center" });
      pre.focus();
      if (document.activeElement !== pre || pre.scrollLeft !== 0)
        throw Error("Scrollable code did not receive initial focus");
      let trustedRight = false;
      const observeRight = (event: KeyboardEvent) => {
        if (
          event.key === "ArrowRight" &&
          event.isTrusted &&
          event.target === pre
        )
          trustedRight = true;
      };
      pre.addEventListener("keydown", observeRight);
      try {
        await pressRight();
        const deadline = performance.now() + 2500;
        while (
          !(trustedRight && pre.scrollLeft > 0) &&
          performance.now() < deadline
        )
          await new Promise((resolve) => setTimeout(resolve, 20));
        if (
          !trustedRight ||
          pre.scrollLeft <= 0 ||
          document.activeElement !== pre
        )
          throw Error(
            `Code after native ArrowRight at ${width}px: trusted=${trustedRight} scroll=${pre.scrollLeft} focus=${document.activeElement === pre} documentFocus=${document.hasFocus()} visibility=${document.visibilityState}`,
          );
      } finally {
        pre.removeEventListener("keydown", observeRight);
      }
      const range = document.createRange();
      range.selectNodeContents(label);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (selection?.toString() !== "emphasis")
        throw Error("formatted text selection");
      selection.removeAllRanges();
      results.push({ width, first, unchanged });
    } finally {
      root.unmount();
      host.remove();
    }
  }
  return results;
}
