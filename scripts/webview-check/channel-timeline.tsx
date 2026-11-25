import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ChannelTimeline } from "../../src/channels/ChannelTimeline.tsx";
import type { LocalChannelWindow } from "../../src/mattermost/local-history.ts";

export function checkChannelTimeline() {
  const host = document.createElement("div");
  host.style.height = "260px";
  document.body.append(host);
  const root = createRoot(host);
  const stamp = Date.UTC(2026, 10, 25, 12);
  const author = () => ({ name: "Ada Example" });
  function draw(channelId: string, top: number, bottom: number) {
    const posts: LocalChannelWindow["posts"] = [];
    for (let n = top; n >= bottom; n--)
      posts.push({
        id: String(n),
        channelId,
        userId: "ada",
        rootId: null,
        createAt: stamp + n * 1000,
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
            newer: { kind: "end" },
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
      if (avatar?.width !== 32 || avatar.height !== 32)
        throw Error("timeline-avatar-slot");
      pane.scrollTop = 0;
      draw(`${channel}-next`, 30, 1);
      if (!atEnd()) throw Error("timeline-channel-change");
    }
  } finally {
    root.unmount();
    host.remove();
  }
}
