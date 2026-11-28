import type { RefObject } from "react";

export type TimelineViewport = RefObject<HTMLElement | null>;
type Anchor = { id: string; offset: number; published: boolean };

export function measureTimeline(
  pane: HTMLElement,
  followEnd = false,
  row?: HTMLElement,
) {
  const atBottom = pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 2;
  if (followEnd && atBottom)
    return { atBottom, top: pane.scrollTop, anchors: [] };
  const bounds = pane.getBoundingClientRect();
  const anchors: Anchor[] = [];
  const rows = row
    ? [row]
    : pane.querySelectorAll<HTMLElement>("[data-post-id]");
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    if (box.top >= bounds.bottom) break;
    const id = row.dataset.postId;
    if (id && box.bottom > bounds.top)
      anchors.push({
        id,
        offset: box.top - bounds.top,
        published: !row.hasAttribute("data-outgoing"),
      });
  }
  return {
    atBottom,
    top: pane.scrollTop,
    anchors,
  };
}

export type TimelinePlace = ReturnType<typeof measureTimeline>;

export type TimelineScrollCorrection = { top: number; remainder: number };

export function restoreTimelineAnchor(
  pane: HTMLElement,
  row: HTMLElement,
  place: { top: number; offset: number },
  correction?: TimelineScrollCorrection,
): TimelineScrollCorrection {
  // WebKit quantizes scrollTop. Carry the unapplied fraction while the reader stays put.
  const remainder = correction?.top === place.top ? correction.remainder : 0;
  const desired =
    pane.scrollTop +
    row.getBoundingClientRect().top -
    pane.getBoundingClientRect().top -
    place.offset +
    remainder;
  const target = Math.min(
    Math.max(0, desired),
    pane.scrollHeight - pane.clientHeight,
  );
  pane.scrollTop = target;
  const top = pane.scrollTop;
  return { top, remainder: target - top };
}

export type ReadingPosition = "latest" | readonly string[];

export function readingPosition(
  pane: HTMLElement,
  latest: boolean,
): ReadingPosition {
  const place = measureTimeline(pane, latest);
  if (place.atBottom && latest) return "latest";
  const published = place.anchors
    .filter((anchor) => anchor.published)
    .map((anchor) => anchor.id);
  // A viewport filled by an outgoing post still belongs to the live end.
  // The DOM scroller keeps its local ID as the visual anchor.
  return latest && !published.length && place.anchors.length
    ? "latest"
    : published;
}
