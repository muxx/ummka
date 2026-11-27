import type { MouseEvent, PointerEvent } from "react";
import { useSyncExternalStore } from "react";

const media = "(max-width: 740px) and (pointer: coarse)";
const action = ".timeline-post-actions";
const interactive = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  "pre",
  "code",
  "table",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]",
  "[role=button]",
  "[role=link]",
  "[tabindex]",
].join(",");

function touchLayout() {
  return typeof matchMedia === "function" && matchMedia(media).matches;
}

function watchTouchLayout(notify: () => void) {
  const query = typeof matchMedia === "function" ? matchMedia(media) : null;
  query?.addEventListener?.("change", notify);
  return () => query?.removeEventListener?.("change", notify);
}

export function useTimelinePostTouchLayout() {
  return useSyncExternalStore(watchTouchLayout, touchLayout);
}

function hitRow(event: PointerEvent<HTMLElement>) {
  // Chromium can dispatch a near-edge tap to another nearby button.
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  const row = hit?.closest<HTMLElement>(".timeline-post");
  if (!row || !event.currentTarget.contains(row)) return null;
  const child = hit?.closest(interactive);
  if (child && row.contains(child) && child !== row && !child.matches(action))
    return null;
  return row.querySelector(action) ? row : null;
}

const selecting = () => document.getSelection()?.isCollapsed === false;

export function createTimelinePostTouch() {
  let press: {
    row: HTMLElement;
    pointer: number;
    x: number;
    y: number;
    began: number;
    selected: boolean;
    blocked: boolean;
    tap: boolean;
  } | null = null;
  const moved = (event: PointerEvent<HTMLElement>) =>
    press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8;
  function block() {
    if (press) press.blocked = true;
  }
  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      press = null;
      if (event.pointerType !== "touch" || !event.isPrimary || !touchLayout())
        return;
      const row = hitRow(event);
      if (!row) return;
      press = {
        row,
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        began: event.timeStamp,
        selected: selecting(),
        blocked: false,
        tap: false,
      };
    },
    onPointerMoveCapture(event: PointerEvent<HTMLElement>) {
      if (press?.pointer === event.pointerId && moved(event)) block();
    },
    onPointerUpCapture(event: PointerEvent<HTMLElement>) {
      if (!press || press.pointer !== event.pointerId) return;
      press.tap =
        !press.blocked &&
        !moved(event) &&
        event.timeStamp - press.began < 500 &&
        hitRow(event) === press.row;
      // A browser may swallow the click while native selection handles are visible.
      if (press.tap && press.selected)
        document.getSelection()?.removeAllRanges();
    },
    onPointerCancelCapture: block,
    onContextMenuCapture: block,
    onClickCapture(event: MouseEvent<HTMLElement>) {
      const gesture = press;
      press = null;
      // The real button still handles keyboard activation and our delegated click.
      if (!gesture || event.detail === 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (gesture.tap && !gesture.blocked && !gesture.selected && !selecting())
        gesture.row.querySelector<HTMLButtonElement>(action)?.click();
    },
  };
}
