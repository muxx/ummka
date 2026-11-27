import { waitFor, within } from "@testing-library/dom";
import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyPalette, resolvePalette } from "../../src/appearance/palette.ts";
import { isMobile, usesMacOSOverlay } from "../../src/build-platform.ts";
import { ChannelsFrame } from "../../src/channels/ChannelsFrame.tsx";

import "../../src/channels/search.css";

export async function checkChannelsFrame() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const html = document.documentElement;
  const style = html.getAttribute("style");
  const previousMode = html.dataset.appearance;
  const title = "Длинное название LongChannelName".repeat(10);
  const labels = {
    account: "Account",
    navigation: "Channels",
    chooseTeam: "Switch team",
    closeThread: "Close thread",
  };
  let page: "navigation" | "conversation" = "conversation";
  let thread: string | null = null;
  let channelId = "general";
  const draftRef = createRef<HTMLInputElement>();
  const replyRef = createRef<HTMLTextAreaElement>();
  const show = () =>
    flushSync(() =>
      root.render(
        <ChannelsFrame
          labels={labels}
          teamName={title}
          accountName="Alex"
          channel={{ id: channelId, title }}
          draftRef={draftRef}
          emptyTitle="Choose a channel"
          page={page}
          onNavigation={() => {
            page = "navigation";
            show();
          }}
          onTeam={() => {}}
          onAccount={() => {}}
          searchTrigger={
            <button type="button" className="channels-search-trigger">
              Search
            </button>
          }
          toolbar={["Mentions", "Saved", "Appearance"].map((action) => (
            <button
              type="button"
              className="channels-icon-action"
              key={action}
              aria-label={action}
            />
          ))}
          navigation={
            <button
              type="button"
              aria-current="page"
              onClick={() => {
                page = "conversation";
                show();
              }}
            >
              General
            </button>
          }
          thread={
            thread
              ? {
                  id: thread,
                  title: "Replies",
                  subtitle: "# General",
                  content: <textarea ref={replyRef} aria-label="Reply" />,
                  replyRef,
                  close: () => {
                    thread = null;
                    show();
                  },
                }
              : undefined
          }
        >
          <input
            ref={draftRef}
            aria-label="Draft"
            defaultValue="Reading position"
          />
          {["first", "second"].map((id) => (
            <button
              type="button"
              key={id}
              data-open-thread={id}
              onClick={() => {
                thread = id;
                show();
              }}
            >
              Open {id} thread
            </button>
          ))}
        </ChannelsFrame>,
      ),
    );
  function control(selector: string) {
    const node = host.querySelector<HTMLElement>(selector);
    if (!node) throw Error(`frame-missing-${selector}`);
    return node;
  }
  try {
    if (navigator.userAgent.includes("Android")) {
      const deadline = performance.now() + 4000;
      while (!document.hasFocus() && performance.now() < deadline)
        await new Promise<void>((done) => setTimeout(done, 25));
      if (!document.hasFocus())
        throw Error("frame-android-window-lacks-input-focus");
    }
    show();
    const draft = control("input");
    const main = control("main");
    const mainHead = control("main > .channels-pane-head");
    const panes = control(".channels-panes");
    const nav = control("nav");
    const open = control('[data-open-thread="first"]');
    const second = control('[data-open-thread="second"]');
    const brand = control(".channels-bar-brand");
    const mark = brand.querySelector("img");
    if (isMobile !== Boolean(mark) || (mark && mark.alt !== "ummka"))
      throw Error("frame-brand-platform");
    await mark?.decode();
    const bar = control(".channels-bar");
    const tools = control(".channels-bar-tools");
    const actions = [...tools.querySelectorAll("button")];
    const account = control(".channels-account");
    const scene = control(".channels-frame");
    const overlay = usesMacOSOverlay;
    if (
      Boolean(brand.closest("[data-tauri-drag-region]")) !== overlay ||
      bar.hasAttribute("data-tauri-drag-region") !== overlay ||
      account.hasAttribute("data-tauri-drag-region")
    )
      throw Error("frame-window-controls");
    const center = (box: DOMRect) => box.top + box.height / 2;
    let previousBar = "";
    for (const mode of ["light", "dark"] as const) {
      applyPalette(html, mode, resolvePalette(mode));
      const barColor = getComputedStyle(bar).backgroundColor;
      if (
        barColor === previousBar ||
        getComputedStyle(main).backgroundColor === barColor
      )
        throw Error("frame-palette");
      previousBar = barColor;
      for (const width of [320, 390, 740, 741, 800, 820, 1024, 1180, 1280]) {
        host.style.width = `${width}px`;
        const bounds = () => main.getBoundingClientRect();
        const narrow = width <= 740;
        const sidebarWidth = width > 1100 ? 244 : width > 900 ? 216 : 180;
        await waitFor(() => {
          if (
            scene.style.getPropertyValue("--navigation-choice") !==
            (narrow ? "" : `${sidebarWidth}px`)
          )
            throw Error(`frame-width-layout-${width}`);
        });
        const radius = narrow ? "0px" : "12px";
        if (
          getComputedStyle(main).borderStartStartRadius !== radius ||
          getComputedStyle(mainHead).borderStartStartRadius !== radius ||
          getComputedStyle(main).overflow !== "visible" ||
          (!narrow &&
            getComputedStyle(panes).backgroundColor !==
              getComputedStyle(nav).backgroundColor)
        )
          throw Error(`frame-channel-corner-${mode}-${width}`);
        const logoBounds = mark?.getBoundingClientRect();
        const barBounds = bar.getBoundingClientRect();
        const toolBounds = tools.getBoundingClientRect();
        const actionBounds = actions.map((button) =>
          button.getBoundingClientRect(),
        );
        const endInset = Number.parseFloat(
          getComputedStyle(bar).paddingInlineEnd,
        );
        if (
          actionBounds.length !== 4 ||
          actionBounds.some(
            (box, index) =>
              box.width !== (index === 3 ? 26 : 32) ||
              box.height !== box.width ||
              Math.abs(center(box) - center(barBounds)) > 1,
          ) ||
          toolBounds.width !== (narrow ? 176 : 141) ||
          Math.abs(barBounds.right - toolBounds.right - endInset) > 1
        )
          throw Error(
            `frame-toolbar-targets-${width} ${JSON.stringify({
              tools: toolBounds.width,
              end: barBounds.right - toolBounds.right,
              endInset,
              actions: actionBounds.map((box) => [
                box.width,
                box.height,
                center(box) - center(barBounds),
              ]),
            })}`,
          );
        if (
          logoBounds &&
          (logoBounds.width !== 24 ||
            logoBounds.height !== 24 ||
            Math.abs(
              center(logoBounds) - center(account.getBoundingClientRect()),
            ) > 1)
        )
          throw Error(`frame-brand-layout-${width}`);
        if (narrow) {
          const search = control(
            ".channels-search-trigger",
          ).getBoundingClientRect();
          if (width === 740 && overlay) {
            const gapEnd = account.getBoundingClientRect().left;
            const y = center(bar.getBoundingClientRect());
            if (
              gapEnd - search.right < 60 ||
              document.elementFromPoint(search.right + 30, y) !== bar ||
              !document.elementFromPoint(search.left + 8, y)?.closest("button")
            )
              throw Error("frame-compact-window-drag-surface");
          }
          if (
            (logoBounds && Math.abs(search.left - logoBounds.right - 7) > 1) ||
            search.height !== 32 ||
            barBounds.height !== (overlay ? 46 : 44) ||
            (logoBounds &&
              Math.abs(
                search.width -
                  Math.min(
                    380,
                    barBounds.right - search.left - endInset - 176 - 7,
                  ),
              ) > 1) ||
            toolBounds.left - search.right < 7 ||
            (overlay && search.left - bar.getBoundingClientRect().left < 76)
          )
            throw Error(`frame-compact-header-${width}`);
          for (const [index, box] of actionBounds.entries()) {
            const x = box.left + box.width / 2;
            const y = center(box);
            for (const dx of [-22, 0, 21]) {
              for (const dy of [-22, 0, 21]) {
                // A fixture resized beyond the WebView cannot receive input offscreen.
                if (x + dx < 0 || x + dx >= innerWidth) continue;
                const hit = document.elementFromPoint(x + dx, y + dy);
                if (!actions[index].contains(hit))
                  throw Error(`frame-compact-action-hit-${width}-${index}`);
              }
            }
          }
        }
        if (!narrow) {
          const search = control(
            ".channels-search-trigger",
          ).getBoundingClientRect();
          if (
            barBounds.height !== 46 ||
            Math.abs(nav.getBoundingClientRect().width - sidebarWidth) > 1 ||
            Math.abs(search.left - nav.getBoundingClientRect().right - 20) >
              1 ||
            Math.abs(search.width - Math.min(520, width * 0.44)) > 1 ||
            Math.abs(search.height - 30) > 1
          )
            throw Error(`frame-search-layout-${width}`);
        }
        if (
          bounds().width <= 0 ||
          (nav.getBoundingClientRect().width === 0) !== narrow
        )
          throw Error("frame-conversation-layout");
        channelId = channelId === "general" ? "second" : "general";
        show();
        if (document.activeElement !== (narrow ? control("h1") : draft))
          throw Error("frame-selected-channel-focus");
        open.focus();
        open.click();
        const aside = control("aside");
        within(aside).getByRole("heading", {
          name: "Replies",
          description: "# General",
        });
        const threadHead = control(
          ".channels-thread-head",
        ).getBoundingClientRect();
        const closeThread = within(aside).getByRole("button", {
          name: labels.closeThread,
        });
        const closeBounds = closeThread.getBoundingClientRect();
        if (
          threadHead.height !== (narrow ? 53 : 70) ||
          (narrow && (closeBounds.width !== 44 || closeBounds.height !== 44))
        )
          throw Error(`frame-thread-header-${mode}-${width}`);
        if (
          getComputedStyle(aside).borderRadius !== "0px" ||
          getComputedStyle(main).borderStartStartRadius !== radius
        )
          throw Error(`frame-channel-corner-with-thread-${mode}-${width}`);
        if (
          document.activeElement !==
            (narrow ? control("h2") : replyRef.current) ||
          aside.clientWidth < 1
        )
          throw Error("frame-thread-focus");
        if (
          narrow
            ? bounds().width !== 0
            : nav.getBoundingClientRect().right > bounds().left + 1 ||
              bounds().right > aside.getBoundingClientRect().left + 1
        )
          throw Error("frame-pane-order");
        if (
          scene.scrollWidth > width + 1 ||
          aside.scrollWidth > aside.clientWidth + 1
        )
          throw Error("frame-overflow");
        if (!narrow) {
          second.click();
          if (document.activeElement !== replyRef.current)
            throw Error("frame-second-thread-focus");
          draft.click();
          draft.focus();
          if (document.activeElement !== draft)
            throw Error("frame-conversation-during-thread");
        }
        closeThread.click();
        if (
          document.activeElement !== (narrow ? open : second) ||
          draft !== control("input")
        )
          throw Error("frame-conversation-return");
        if (narrow) {
          control(".channels-mobile-back").click();
          const row = control('nav [aria-current="page"]');
          if (
            main.clientWidth !== 0 ||
            nav.clientWidth < 1 ||
            document.activeElement !== row
          )
            throw Error("frame-navigation-return");
          row.click();
          if (
            document.activeElement !== control("h1") ||
            draft !== control("input")
          )
            throw Error("frame-channel-focus");
        }
      }
    }
    host.style.width = "820px";
    await waitFor(() => {
      if (scene.style.getPropertyValue("--navigation-choice") !== "180px")
        throw Error("frame-side-test-layout-820");
    });
    host.style.width = "1440px";
    const frameUi = within(host);
    const right = () =>
      frameUi.getByRole("separator", { name: "Side pane width" });
    const navigation = () =>
      frameUi.getByRole("separator", { name: "Navigation pane width" });
    const value = (width: number) => {
      if (
        right().getAttribute("aria-valuenow") !== String(width) ||
        control("aside").getBoundingClientRect().width !== width
      )
        throw Error(`frame-right-width-${width}`);
    };
    const key = (target: HTMLElement, key: string, shiftKey = false) =>
      flushSync(() =>
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            shiftKey,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    const storageKey = "ummka.layout.width.right";
    const previous = localStorage.getItem(storageKey);
    try {
      open.click();
      await waitFor(() => {
        value(400);
        const range = ["orientation", "valuemin", "valuemax"].map((field) =>
          right().getAttribute(`aria-${field}`),
        );
        if (range.join("/") !== "vertical/304/464")
          throw Error(
            `frame-right-range ${range.join("/")} at ${scene.clientWidth}px`,
          );
      });
      right().focus();
      key(right(), "End");
      value(464);
      key(right(), "ArrowRight", true);
      value(416);
      if (localStorage.getItem(storageKey) !== "416")
        throw Error("frame-right-storage");
      const expand = frameUi.getByRole("button", { name: "Expand panel" });
      flushSync(() => expand.click());
      if (
        frameUi.queryByRole("separator", { name: "Side pane width" }) ||
        control("aside").getBoundingClientRect().width !== 864 ||
        document.activeElement !== expand ||
        expand.getAttribute("aria-label") !== "Restore narrow panel"
      )
        throw Error("frame-right-expand");
      flushSync(() => expand.click());
      value(416);
      right().focus();
      host.style.width = "390px";
      await waitFor(() => {
        if (
          frameUi.queryAllByRole("separator").length ||
          control("aside").getBoundingClientRect().width !== 390 ||
          document.activeElement !== control("h2")
        )
          throw Error("frame-compact-thread-width-or-focus");
      });
      host.style.width = "1440px";
      await waitFor(() => value(416));
      flushSync(() =>
        right().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
      );
      value(400);
      if (
        localStorage.getItem(storageKey) !== null ||
        draft !== control("input")
      )
        throw Error("frame-reset-width");
      frameUi.getByRole("button", { name: labels.closeThread }).click();
      navigation().focus();
      if (document.activeElement !== navigation())
        throw Error("frame-navigation-separator-focus");
    } finally {
      if (previous === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, previous);
    }
    // Let the wide layout reach the display before moving focus and narrowing it.
    await new Promise<void>((resolve, reject) => {
      const observer = new ResizeObserver(([entry]) => {
        if (entry.contentRect.width === 1180) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve();
        }
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(Error("frame-wide-layout-not-observed"));
      }, 3000);
      observer.observe(scene);
      host.style.width = "1180px";
    });
    const row = control('nav [aria-current="page"]');
    row.focus();
    if (document.activeElement !== row) throw Error("frame-wide-row-focus");
    host.style.width = "320px";
    const deadline = performance.now() + 2500;
    while (
      document.activeElement !== control("h1") &&
      performance.now() < deadline
    )
      await new Promise<void>((done) => setTimeout(done, 25));
    if (document.activeElement !== control("h1"))
      throw Error(
        `frame-resize-focus ${document.visibilityState} ${document.activeElement?.tagName}`,
      );
  } finally {
    root.unmount();
    host.remove();
    if (style === null) html.removeAttribute("style");
    else html.setAttribute("style", style);
    if (previousMode === undefined) delete html.dataset.appearance;
    else html.dataset.appearance = previousMode;
  }
}
