import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ChannelTimeline } from "../../src/channels/ChannelTimeline.tsx";
import type { LocalChannelWindow } from "../../src/mattermost/local-history.ts";

export async function checkChannelTimeline() {
  const fixture = document.createElement("div");
  // A simulated wide channel must not widen the mobile WebView's viewport.
  fixture.style.overflow = "clip";
  const host = document.createElement("div");
  host.style.height = "260px";
  fixture.append(host);
  document.body.append(fixture);
  const root = createRoot(host);
  const stamp = Date.UTC(2026, 10, 25, 12);
  const author = () => ({ name: "Ada Example" });
  function draw(
    channelId: string,
    top: number,
    bottom: number,
    historical = false,
    multipleDays = false,
  ) {
    const posts: LocalChannelWindow["posts"] = [];
    for (let n = top; n >= bottom; n--)
      posts.push({
        id: String(n),
        channelId,
        userId: "ada",
        rootId: null,
        createAt:
          stamp + n * 1000 + (multipleDays ? Math.floor(n / 6) * 86400000 : 0),
        updateAt: stamp + n * 1000,
        editAt: 0,
        isPinned: false,
        type: "",
        hashtags: "",
        message: `Reading long messages ${n} ${"abc".repeat(65)}`,
        messageSource: null,
      });
    flushSync(() =>
      root.render(
        <ChannelTimeline
          channelId={channelId}
          locale="en"
          timeZone="UTC"
          offline={false}
          author={author}
          page={{
            posts,
            older: { kind: "end" },
            newer: historical
              ? { kind: "more", postId: String(top) }
              : { kind: "end" },
            firstInaccessiblePostTime: 0,
          }}
        />,
      ),
    );
  }
  try {
    for (const width of [320, 820]) {
      host.style.width = `${width}px`;
      const channel = `channel-${width}`;
      draw(channel, 40, 10);
      const pane = host.querySelector<HTMLElement>(".timeline-scroll");
      if (
        !pane ||
        pane.scrollTop <= 0 ||
        pane.scrollWidth > pane.clientWidth + 1
      )
        throw Error("timeline-initial-position");
      const atEnd = () =>
        Math.abs(pane.scrollHeight - pane.clientHeight - pane.scrollTop) < 2;
      if (!atEnd()) throw Error("timeline-cold-bottom");
      const row = host.querySelector<HTMLElement>('[data-post-id="25"]');
      if (!row) throw Error("timeline-reading-row");
      const offset = () =>
        row.getBoundingClientRect().top - pane.getBoundingClientRect().top;
      pane.scrollTop += offset() - 15;
      const anchor = offset();
      draw(channel, 40, 1);
      if (Math.abs(offset() - anchor) > 1 || atEnd())
        throw Error("timeline-prepend-anchor");
      draw(channel, 41, 1);
      if (Math.abs(offset() - anchor) > 1)
        throw Error("timeline-append-while-reading");
      pane.scrollTop = pane.scrollHeight;
      draw(channel, 42, 1);
      if (!atEnd()) throw Error("timeline-stay-at-bottom");
      const avatar = host
        .querySelector(".timeline-avatar")
        ?.getBoundingClientRect();
      const avatarSize = matchMedia("(max-width: 740px)").matches ? 30 : 34;
      if (avatar?.width !== avatarSize || avatar.height !== avatarSize)
        throw Error("timeline-avatar-slot");
      pane.scrollTop = 0;
      draw(`${channel}-next`, 30, 1);
      if (!atEnd()) throw Error("timeline-channel-change");
    }
    const pane = host.querySelector<HTMLElement>(".timeline-scroll");
    if (!pane) throw Error("Missing channel timeline");
    const row = (id: number) => {
      const element = pane.querySelector<HTMLElement>(`[data-post-id="${id}"]`);
      if (!element) throw Error(`Missing timeline row ${id}`);
      return element.getBoundingClientRect();
    };
    const offset = (id: number) =>
      row(id).top - pane.getBoundingClientRect().top;
    const bottomGap = () =>
      pane.scrollHeight - pane.clientHeight - pane.scrollTop;
    async function resize(width: number, height: number) {
      host.style.width = `${width}px`;
      host.style.height = `${height}px`;
      const until = performance.now() + 4000;
      while (true) {
        const box = pane?.getBoundingClientRect();
        if (box?.width === width && box.height === height) break;
        if (performance.now() > until)
          throw Error(`Timeline did not resize to ${width} × ${height}`);
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
    }
    const checkShort = () => {
      const gap = pane.getBoundingClientRect().bottom - row(20).bottom;
      if (Math.abs(gap - 14) > 1)
        throw Error(
          `Short channel history is displaced by ${gap}px from the composer`,
        );
      const day = pane.querySelector(".timeline-day")?.getBoundingClientRect();
      if (!day || Math.abs(row(20).top - day.bottom) > 1)
        throw Error("Day separated from the only post");
    };
    draw("short", 20, 20);
    await resize(390, 450);
    checkShort();
    await resize(820, 320);
    checkShort();
    draw("short", 65, 1);
    if (Math.abs(bottomGap()) > 1)
      throw Error("Lost end when short conversation grew");
    await resize(320, 530);
    if (Math.abs(bottomGap()) > 1)
      throw Error("Resizing at the end displaced the latest post");
    // Widening the pane rewraps the older posts above the partially visible row.
    pane.focus({ preventScroll: true });
    pane.scrollTop += offset(30) + 9;
    const readingPosition = () => ({
      offset: offset(30),
      scrollTop: pane.scrollTop,
      precedingHeight: row(30).top - row(1).top,
      viewportWidth: window.innerWidth,
    });
    const before = readingPosition();
    await resize(820, 440);
    const after = readingPosition();
    const measurements = JSON.stringify({ before, after });
    if (before.viewportWidth !== after.viewportWidth)
      throw Error(`Timeline resize changed the WebView width ${measurements}`);
    if (after.precedingHeight >= before.precedingHeight)
      throw Error(`Older messages did not rewrap ${measurements}`);
    if (Math.abs(after.offset - before.offset) > 1)
      throw Error(
        `Rewrapping older messages displaced the post being read ${measurements}`,
      );
    if (document.activeElement !== pane)
      throw Error("Rewrapping older messages moved focus out of the timeline");
    await resize(820, 280);
    if (Math.abs(offset(30) - before.offset) > 1)
      throw Error("Height change displaced the post being read");
    pane.scrollTop = 0;
    if (offset(1) < 0 || offset(1) >= pane.clientHeight)
      throw Error("First published message is unreachable");
    pane.scrollTop = pane.scrollHeight;
    if (row(65).bottom > pane.getBoundingClientRect().bottom + 1)
      throw Error("Last published message is unreachable");
    draw("short", 20, 20);
    checkShort();
    draw("older-page", 20, 20, true);
    if (
      offset(20) > pane.clientHeight / 2 ||
      !pane.textContent?.includes("Later messages")
    )
      throw Error("Older page with a continuation followed the live end");
    draw("several-days", 46, 1, false, true);
    for (const width of [390, 820]) {
      await resize(width, 260);
      for (const id of [20, 32, 14]) {
        pane.scrollTop += offset(id);
        const day = pane
          .querySelector(`[data-post-id="${id}"]`)
          ?.closest(".timeline-day-group");
        const tag = day?.querySelector(".timeline-day");
        if (!day || !tag) throw Error("Reading day missing");
        const top = pane.getBoundingClientRect().top;
        const pinned = [...pane.querySelectorAll(".timeline-day")].filter(
          (el) => Math.abs(el.getBoundingClientRect().top - top) <= 1,
        );
        if (pinned.length !== 1 || pinned[0] !== tag)
          throw Error("Only the day being read should stay at the top");
        const line = getComputedStyle(day, "::before");
        if (
          line.position !== "absolute" ||
          Math.abs(parseFloat(line.width) - pane.clientWidth) > 1 ||
          day.getBoundingClientRect().top >= top - 1
        )
          throw Error(
            "Date rule should scroll with its section and reach both edges",
          );
      }
    }
    draw("empty", 0, 1);
    const empty = pane
      .querySelector(".timeline-empty")
      ?.getBoundingClientRect();
    if (
      !empty ||
      empty.top - pane.getBoundingClientRect().top >= pane.clientHeight / 2
    )
      throw Error("Empty channel explanation moved away from the start");
    const grouped: LocalChannelWindow["posts"] = (
      ["standard", "standard", "important", "urgent", "standard"] as const
    ).map((displayPriority, index) => ({
      id: String(index),
      channelId: "groups",
      userId: "ada",
      rootId: null,
      createAt: stamp + index * 60_000,
      updateAt: stamp + index * 60_000,
      editAt: 0,
      isPinned: false,
      type: "",
      hashtags: "",
      message: "Short message",
      messageSource: null,
      displayPriority,
      aiAttribution: { kind: "none" },
      fromWebhook: false,
    }));
    for (const width of [390, 820]) {
      await resize(width, 260);
      flushSync(() =>
        root.render(
          <ChannelTimeline
            channelId="groups"
            locale="en"
            timeZone="UTC"
            offline={false}
            author={() => ({ name: "Ada Example", isBot: false })}
            page={{
              posts: [...grouped].reverse(),
              older: { kind: "end" },
              newer: { kind: "end" },
              firstInaccessiblePostTime: 0,
            }}
          />,
        ),
      );
      const rows = [...pane.querySelectorAll(".timeline-post")];
      const continued = rows
        .filter((row) => row.hasAttribute("data-continuation"))
        .map((row) => row.getAttribute("data-post-id"))
        .join(",");
      const body = (row: Element) =>
        row.querySelector(".published-post")?.getBoundingClientRect();
      const first = body(rows[0]);
      const second = body(rows[1]);
      if (
        continued !== "1,4" ||
        !first ||
        !second ||
        Math.abs(first.left - second.left) > 0.5 ||
        rows[1].getBoundingClientRect().height >=
          rows[0].getBoundingClientRect().height ||
        rows[2].querySelector(".timeline-priority")?.textContent !==
          "Important" ||
        rows[3].querySelector(".timeline-priority")?.textContent !== "Urgent"
      )
        throw Error(
          "Grouped channel changed its aligned body or priority headings",
        );
    }
  } finally {
    root.unmount();
    fixture.remove();
  }
}
