import {
  type ReactNode,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isAndroid } from "../build-platform.ts";
import type { EntryLanguage } from "../entry/language.ts";
import { measureTimeline } from "./timeline-viewport.ts";
import "./post-body-disclosure.css";

const copy = {
  en: { open: "Show full message", close: "Collapse message" },
  ru: { open: "Показать полностью", close: "Свернуть" },
};

function heightLimit() {
  return isAndroid ? Math.round(window.innerHeight / 2 + 54) : 600;
}

function readingAnchor(viewport: HTMLElement) {
  const pane = viewport.closest<HTMLElement>(".timeline-scroll");
  const post = viewport.closest<HTMLElement>("[data-post-id]");
  if (
    !pane ||
    !post ||
    post.getBoundingClientRect().bottom > pane.getBoundingClientRect().top
  )
    return null;
  const [visible] = measureTimeline(pane).anchors;
  const anchor =
    visible &&
    pane.querySelector<HTMLElement>(
      `[data-post-id="${CSS.escape(visible.id)}"]`,
    );
  return anchor
    ? { pane, anchor, top: anchor.getBoundingClientRect().top }
    : null;
}

const clippedControl = "data-post-disclosure-clipped";
const controls = `[${clippedControl}], a[href], button, input, select, textarea, [tabindex]`;

function keepAuthoredInert(changes: MutationRecord[]) {
  for (const change of changes)
    if (
      change.attributeName === "inert" &&
      change.target instanceof HTMLElement
    )
      change.target.removeAttribute(clippedControl);
}

function restoreClippedControl(control: HTMLElement) {
  control.removeAttribute(clippedControl);
  control.removeAttribute("inert");
}

function updateClippedControls(text: HTMLDivElement, viewport: HTMLDivElement) {
  const targets = text.querySelectorAll<HTMLElement>(controls);
  if (!targets.length) return false;
  const bounds = viewport.getBoundingClientRect();
  if (!bounds.width) return false;
  const active = document.activeElement;
  let lostFocus = false;
  for (const control of targets) {
    const dialog = control.closest("dialog[open]");
    const rect = control.getBoundingClientRect();
    const hidden =
      !control.matches(":disabled") &&
      !(dialog && text.contains(dialog)) &&
      rect.height > 0 &&
      rect.top >= bounds.bottom;
    if (hidden && !control.hasAttribute("inert")) {
      lostFocus ||= control.contains(active);
      control.setAttribute(clippedControl, "");
      control.setAttribute("inert", "");
    } else if (!hidden && control.hasAttribute(clippedControl)) {
      restoreClippedControl(control);
    }
  }
  return lostFocus;
}

export function PostBodyDisclosure({
  children,
  locale,
}: {
  children: ReactNode;
  locale: EntryLanguage;
}) {
  const id = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const contentChanges = useRef<MutationObserver | null>(null);
  const position = useRef<{
    pane: HTMLElement;
    anchor: HTMLElement;
    top: number;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [measured, setMeasured] = useState(() => ({
    limit: heightLimit(),
    overflow: false,
  }));
  const folded = measured.overflow && !expanded;
  const clippingHeight = folded ? measured.limit : null;

  const reconcileClippedControls = useEffectEvent(() => {
    const observer = contentChanges.current;
    if (!observer || !body.current || !viewport.current) return;
    // Respect an inert attribute authored by a child, even if the child
    // sets it while the disclosure already has it clipped.
    keepAuthoredInert(observer.takeRecords());
    const lostFocus = updateClippedControls(body.current, viewport.current);
    observer.takeRecords();
    if (lostFocus) {
      button.current?.focus({ preventScroll: true });
      button.current?.scrollIntoView({ block: "nearest" });
    }
  });

  const publishSize = useEffectEvent((text: HTMLDivElement) => {
    const { height, width } = text.getBoundingClientRect();
    // A hidden channel keeps its last measurement until it is visible again.
    if (!width) return;
    const limit = heightLimit();
    const overflow = height > limit;
    if (measured.overflow === overflow && measured.limit === limit) {
      reconcileClippedControls();
      return;
    }
    if (viewport.current) position.current ??= readingAnchor(viewport.current);
    setMeasured({ overflow, limit });
  });

  useLayoutEffect(() => {
    const text = body.current;
    if (!text) return;
    const measure = () => publishSize(text);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    if (isAndroid) window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      if (isAndroid) window.removeEventListener("resize", measure);
    };
  }, []);

  useLayoutEffect(() => {
    const text = body.current;
    if (!folded || !text) return;
    const mutations = new MutationObserver((changes) => {
      keepAuthoredInert(changes);
      reconcileClippedControls();
    });
    contentChanges.current = mutations;
    mutations.observe(text, {
      childList: true,
      characterData: true,
      subtree: true,
      attributeFilter: [
        "class",
        "disabled",
        "hidden",
        "inert",
        "open",
        "style",
        "tabindex",
      ],
    });
    return () => {
      keepAuthoredInert(mutations.takeRecords());
      mutations.disconnect();
      contentChanges.current = null;
      for (const control of text.querySelectorAll<HTMLElement>(
        `[${clippedControl}]`,
      ))
        restoreClippedControl(control);
    };
  }, [folded]);

  useLayoutEffect(() => {
    if (clippingHeight !== null) reconcileClippedControls();
  }, [clippingHeight]);

  useLayoutEffect(() => {
    const place = position.current;
    position.current = null;
    if (place?.pane.contains(place.anchor)) {
      // Opening preserves the visible text. Closing keeps the action in view.
      place.pane.scrollTop +=
        place.anchor.getBoundingClientRect().top - place.top;
    }
  });

  return (
    <div className="post-body-disclosure">
      <div
        id={id}
        className="post-body-disclosure-viewport"
        ref={viewport}
        data-collapsed={!expanded || undefined}
        data-folded={folded || undefined}
        style={!expanded ? { maxBlockSize: measured.limit } : undefined}
      >
        <div className="post-body-disclosure-content" ref={body}>
          {children}
        </div>
      </div>
      {measured.overflow && (
        <button
          type="button"
          className="post-body-disclosure-action"
          ref={button}
          aria-controls={id}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            const anchor = expanded ? event.currentTarget : viewport.current;
            const pane = anchor?.closest<HTMLElement>(".timeline-scroll");
            if (anchor && pane)
              position.current = {
                pane,
                anchor,
                top: anchor.getBoundingClientRect().top,
              };
            setExpanded(!expanded);
          }}
        >
          {expanded ? copy[locale].close : copy[locale].open}
        </button>
      )}
    </div>
  );
}
