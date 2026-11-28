import { Component, type ReactNode, type RefObject } from "react";

type Props = {
  pane: RefObject<HTMLElement | null>;
  label: string;
  children: ReactNode;
  pins?: boolean;
};
type RowPlace = { id: string; y: number };
type Snapshot = {
  rows: RowPlace[];
  focused: HTMLButtonElement | null;
  index: number;
};
export type CollectionReadingPlace = {
  scroll: number;
  anchor?: { id: string; offset: number };
  focusedId?: string;
};

const rowSelector = "[data-collection-post]";
const postRow = (pane: HTMLElement, id: string) =>
  pane.querySelector<HTMLButtonElement>(
    `[data-collection-post="${CSS.escape(id)}"]`,
  );

function firstVisibleRow(rows: NodeListOf<HTMLButtonElement>, top: number) {
  let first = 0;
  let end = rows.length;
  while (first < end) {
    const middle = first + Math.floor((end - first) / 2);
    if (rows[middle].getBoundingClientRect().bottom <= top) first = middle + 1;
    else end = middle;
  }
  return first;
}

export function collectionReadingPlace(
  pane: HTMLElement,
): CollectionReadingPlace {
  const rows = pane.querySelectorAll<HTMLButtonElement>(rowSelector);
  const top = pane.getBoundingClientRect().top;
  const first = rows[firstVisibleRow(rows, top)];
  const id = first?.dataset.collectionPost;
  const active = document.activeElement;
  return {
    scroll: pane.scrollTop,
    anchor: id
      ? { id, offset: first.getBoundingClientRect().top - top }
      : undefined,
    focusedId:
      active instanceof HTMLButtonElement && pane.contains(active)
        ? (active.dataset.collectionPost ?? active.dataset.collectionRemove)
        : undefined,
  };
}

export function restoreCollectionReadingPlace(
  pane: HTMLElement | null,
  place: CollectionReadingPlace | undefined,
) {
  if (!pane || !place) return false;
  pane.scrollTop = place.scroll;
  const anchor = place.anchor && postRow(pane, place.anchor.id);
  if (anchor && place.anchor)
    pane.scrollTop +=
      anchor.getBoundingClientRect().top -
      pane.getBoundingClientRect().top -
      place.anchor.offset;
  const row = (place.focusedId && postRow(pane, place.focusedId)) || anchor;
  row?.focus({ preventScroll: true });
  return Boolean(row);
}

export function restoreCollectionRow(
  pane: HTMLElement | null,
  previous: { id: string; scroll: number; offset?: number } | null,
  notice?: HTMLElement | null,
) {
  if (!pane || !previous) return false;
  const row = postRow(pane, previous.id);
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
      (active.matches("[data-collection-post], [data-collection-retry]") ||
        (this.props.pins && active.hasAttribute("data-collection-remove")))
        ? active
        : null;
    const rows = pane?.querySelectorAll<HTMLButtonElement>(rowSelector);
    const id =
      focused?.dataset.collectionPost ?? focused?.dataset.collectionRemove;
    const index =
      this.props.pins && id && rows
        ? Array.from(rows).findIndex((row) => row.dataset.collectionPost === id)
        : -1;
    if (!pane?.clientHeight || pane.scrollTop <= 1)
      return { rows: [], focused, index };
    const bounds = pane.getBoundingClientRect();
    if (!rows) return { rows: [], focused, index };
    const first = firstVisibleRow(rows, bounds.top);
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
    return { rows: [...whole, ...clipped], focused, index };
  }
  componentDidUpdate(_props: Props, _state: unknown, previous: Snapshot) {
    const pane = this.props.pane.current;
    if (!pane) return;
    let surviving: HTMLElement | null = null;
    for (const place of previous.rows) {
      const row = postRow(pane, place.id);
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
    ) {
      const removedAction = previous.focused.dataset.collectionRemove;
      const same = removedAction && postRow(pane, removedAction);
      const rows = pane.querySelectorAll<HTMLElement>(rowSelector);
      const neighbor =
        previous.index < 0
          ? undefined
          : rows[Math.min(previous.index, rows.length - 1)];
      const nextAction =
        removedAction && !same && neighbor?.dataset.collectionPost
          ? pane.querySelector<HTMLButtonElement>(
              `[data-collection-remove="${CSS.escape(neighbor.dataset.collectionPost)}"]:not(:disabled)`,
            )
          : null;
      (
        (same || nextAction || neighbor) ??
        surviving ??
        rows[0] ??
        (this.props.pins
          ? pane.querySelector<HTMLElement>(".panel-state--empty h3")
          : null) ??
        pane.closest("aside")?.querySelector("h2")
      )?.focus({ preventScroll: true });
    }
  }
  render() {
    return (
      <section
        ref={this.props.pane}
        className="channels-pane-body collection-rows"
        aria-label={this.props.label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users can scroll the results even when there are no row buttons.
        tabIndex={0}
      >
        {this.props.children}
      </section>
    );
  }
}
