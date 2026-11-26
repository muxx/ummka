import type { RefObject } from "react";

export type TimelineViewport = RefObject<HTMLElement | null>;
type Anchor = { id: string; offset: number; published: boolean };

export function measureTimeline(pane: HTMLElement, followEnd = false) {
  const atBottom = pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 2;
  if (followEnd && atBottom)
    return { atBottom, top: pane.scrollTop, anchors: [] };
  const bounds = pane.getBoundingClientRect();
  const anchors: Anchor[] = [];
  for (const row of pane.querySelectorAll<HTMLElement>("[data-post-id]")) {
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
