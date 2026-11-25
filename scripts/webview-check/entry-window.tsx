import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  applyPalette,
  auroraColors,
  resolvePalette,
} from "../../src/appearance/palette.ts";
import { EntryWindow } from "../../src/entry/EntryWindow.tsx";

export async function checkEntryWindow() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const html = document.documentElement;
  const originalStyle = html.getAttribute("style");
  const originalMode = html.dataset.appearance;
  try {
    const renderCard = (tall = false) =>
      flushSync(() =>
        root.render(
          <EntryWindow back={{ label: "Back", activate() {} }}>
            <h1>Server</h1>
            <div style={{ height: tall ? innerHeight * 2 : 48 }} />
            <button type="button">Continue</button>
          </EntryWindow>,
        ),
      );
    renderCard();
    const scene = host.querySelector<HTMLElement>(".entry-window");
    const main = host.querySelector("main");
    const card = host.querySelector<HTMLElement>(".entry-card");
    const action = main?.querySelector("button");
    if (!scene || !card || !main || !action) throw Error("entry-landmarks");
    if (import.meta.env.UMMKA_MACOS_OVERLAY === true) {
      const back = host.querySelector(".entry-back")?.getBoundingClientRect();
      if (!back) throw Error("entry-back-missing");
      const bounds = scene.getBoundingClientRect();
      const centerY = back.top + back.height / 2 - bounds.top;
      const left = back.left - bounds.left;
      if (Math.abs(centerY - 23) > 1 || left < 80)
        throw Error(
          `entry-back-window-controls-alignment centerY=${centerY} left=${left}`,
        );
    }
    const brands = Array.from(host.querySelectorAll("img"));
    await Promise.all(brands.map((img) => img.decode()));
    if (
      brands.filter((img) => img.getBoundingClientRect().height > 0).length !==
      1
    )
      throw Error("entry-visible-brand");
    const cardBounds = card.getBoundingClientRect();
    if (
      cardBounds.left < 0 ||
      cardBounds.right > innerWidth + 1 ||
      main.scrollWidth > main.clientWidth + 1
    )
      throw Error("entry-horizontal-overflow");
    if (matchMedia("(min-width: 56rem) and (min-height: 37rem)").matches) {
      const logo = brands.find((img) => img.getBoundingClientRect().width > 0);
      if (!logo) throw Error("entry-large-brand");
      const center = (box: DOMRect) => (box.top + box.bottom) / 2;
      if (
        Math.abs(center(cardBounds) - innerHeight / 2) > 2 ||
        Math.abs(center(logo.getBoundingClientRect()) - center(cardBounds)) > 2
      )
        throw Error("entry-vertical-center");
    }
    action.focus();
    let previousSky = "";
    for (const mode of ["light", "dark"] as const) {
      applyPalette(html, mode, resolvePalette(mode, auroraColors[mode]));
      const sky = getComputedStyle(scene).backgroundImage;
      if (
        !sky.includes("url(") ||
        sky === previousSky ||
        document.activeElement !== action
      )
        throw Error("entry-appearance");
      previousSky = sky;
    }
    renderCard(true);
    main.scrollTop = 0;
    if (card.getBoundingClientRect().top < main.getBoundingClientRect().top - 1)
      throw Error("entry-unreachable-start");
    action.scrollIntoView({ block: "end" });
    const visible = main.getBoundingClientRect();
    const bottom = action.getBoundingClientRect();
    if (bottom.bottom > visible.bottom + 1 || bottom.top < visible.top - 1)
      throw Error("entry-unreachable-action");
  } finally {
    root.unmount();
    host.remove();
    if (originalStyle === null) html.removeAttribute("style");
    else html.setAttribute("style", originalStyle);
    if (originalMode === undefined) delete html.dataset.appearance;
    else html.dataset.appearance = originalMode;
  }
}
