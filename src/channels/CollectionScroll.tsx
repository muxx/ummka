import { Component, type ReactNode, type RefObject } from "react";

type Props = { pane: RefObject<HTMLDivElement | null>; children: ReactNode };
type RowPlace = { id: string; y: number };
type Snapshot = { rows: RowPlace[]; focused: HTMLButtonElement | null };

export function restoreCollectionRow(
  pane: HTMLDivElement | null,
  previous: { id: string; scroll: number; offset?: number } | null,
  notice?: HTMLElement | null,
) {
  if (!pane || !previous) return false;
  const row = pane.querySelector<HTMLButtonElement>(
    `[data-collection-post="${CSS.escape(previous.id)}"]`,
  );
  if (!row) return false;
  pane.scrollTop = previous.scroll;
  const bounds = pane.getBoundingClientRect();
  if (previous.offset !== undefined)
    pane.scrollTop +=
      row.getBoundingClientRect().top - bounds.top - previous.offset;
  const box = row.getBoundingClientRect();
  row.focus({ preventScroll: true });
  const top = Math.max(
    bounds.top,
    notice?.getBoundingClientRect().bottom ?? bounds.top,
  );
  if (notice)
    pane.scrollTop +=
      box.top < top ? box.top - top : Math.max(0, box.bottom - bounds.bottom);
  else if (box.top < top || box.bottom > bounds.bottom)
    row.scrollIntoView({ block: "nearest" });
  return true;
}

export class CollectionScroll extends Component<Props> {
  // Capture the reading position before React changes row or status heights.
  getSnapshotBeforeUpdate(): Snapshot {
    const pane = this.props.pane.current;
    const active = document.activeElement;
    const focused =
      active instanceof HTMLButtonElement &&
      pane?.contains(active) &&
      active.hasAttribute("data-collection-post")
        ? active
        : null;
    if (!pane?.clientHeight || pane.scrollTop <= 1)
      return { rows: [], focused };
    const bounds = pane.getBoundingClientRect();
    const rows = pane.querySelectorAll<HTMLButtonElement>(
      "[data-collection-post]",
    );
    let first = 0,
      end = rows.length;
    while (first < end) {
      const middle = first + Math.floor((end - first) / 2);
      if (rows[middle].getBoundingClientRect().bottom <= bounds.top)
        first = middle + 1;
      else end = middle;
    }
    const whole: RowPlace[] = [];
    const clipped: RowPlace[] = [];
    for (let n = first; n < rows.length; n++) {
      const row = rows[n],
        box = row.getBoundingClientRect();
      if (box.top >= bounds.bottom) break;
      const id = row.dataset.collectionPost;
      if (!id) continue;
      const places =
        box.top >= bounds.top && box.bottom <= bounds.bottom ? whole : clipped;
      places.push({ id, y: box.top });
    }
    // If the first fully visible message is removed, keep the next one in place.
    // A message clipped above the viewport would anchor the opposite side of the removal.
    return { rows: [...whole, ...clipped], focused };
  }
  componentDidUpdate(_props: Props, _state: unknown, previous: Snapshot) {
    const pane = this.props.pane.current;
    if (!pane) return;
    let surviving: HTMLElement | null = null;
    for (const place of previous.rows) {
      const row = pane.querySelector<HTMLElement>(
        `[data-collection-post="${CSS.escape(place.id)}"]`,
      );
      if (row) {
        pane.scrollTop += row.getBoundingClientRect().top - place.y;
        surviving = row;
        break;
      }
    }
    if (
      previous.focused &&
      !previous.focused.isConnected &&
      document.activeElement === document.body
    )
      (
        surviving ??
        pane.querySelector<HTMLElement>("[data-collection-post]") ??
        pane.closest("aside")?.querySelector("h2")
      )?.focus({ preventScroll: true });
  }
  render() {
    return (
      <div ref={this.props.pane} className="channels-pane-body collection-rows">
        {this.props.children}
      </div>
    );
  }
}
