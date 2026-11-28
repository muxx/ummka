import {
  Component,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";

type Props = {
  pane: RefObject<HTMLElement | null>;
  label: string;
  children: ReactNode;
  pins?: boolean;
  preserveLeading?: boolean;
  ownRemoval?: () => boolean;
  keepTop?: boolean;
};
type Anchor = { id: string; offset: number };
type RowPlace = { id: string; y: number };
type Snapshot = {
  rows: RowPlace[];
  leading?: { order: NodeListOf<HTMLButtonElement>; index: number; y: number };
  focused: HTMLButtonElement | null;
  index: number;
};
export type CollectionReadingPlace = {
  scroll: number;
  anchor?: Anchor;
  nearby?: Anchor[];
  focusedId?: string;
};

export type CollectionReading = {
  place?: CollectionReadingPlace;
  attach(pane: HTMLElement): () => void;
  anchor(): string | undefined;
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
  const first = firstVisibleRow(rows, top);
  const active = document.activeElement;
  const anchors: Anchor[] = [];
  for (const index of [first, first - 1, first + 1, first - 2, first + 2]) {
    const row = rows[index];
    if (row?.dataset.collectionPost)
      anchors.push({
        id: row.dataset.collectionPost,
        offset: row.getBoundingClientRect().top - top,
      });
  }
  const [anchor, ...nearby] = anchors;
  return {
    scroll: pane.scrollTop,
    anchor,
    nearby,
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
  let anchor: HTMLButtonElement | null = null;
  for (const point of [place.anchor, ...(place.nearby ?? [])]) {
    if (!point) continue;
    anchor = postRow(pane, point.id);
    if (!anchor) continue;
    pane.scrollTop +=
      anchor.getBoundingClientRect().top -
      pane.getBoundingClientRect().top -
      point.offset;
    break;
  }
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

export function useCollectionReading(
  pane: RefObject<HTMLElement | null>,
  heading: RefObject<HTMLHeadingElement | null>,
  restore: RefObject<Parameters<typeof restoreCollectionRow>[1]>,
  reading: CollectionReading | undefined,
) {
  const openingPlace = useRef(reading?.place);
  useLayoutEffect(() => {
    if (restoreCollectionRow(pane.current, restore.current))
      restore.current = null;
    else if (
      restore.current ||
      !restoreCollectionReadingPlace(pane.current, openingPlace.current)
    )
      heading.current?.focus();
  }, [pane, heading, restore]);
  useLayoutEffect(() => {
    if (pane.current && reading) return reading.attach(pane.current);
  }, [pane, reading]);
}

export class CollectionScroll extends Component<Props> {
  // Capture the reading position before React changes row or status heights.
  getSnapshotBeforeUpdate(old: Props): Snapshot {
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
    if (!pane?.clientHeight || (pane.scrollTop <= 1 && !old.keepTop))
      return { rows: [], focused, index };
    const bounds = pane.getBoundingClientRect();
    if (!rows) return { rows: [], focused, index };
    const first = firstVisibleRow(rows, bounds.top);
    if (old.preserveLeading && !this.props.ownRemoval?.()) {
      const row = rows[first];
      return {
        rows: [],
        focused,
        index,
        leading: row
          ? { order: rows, index: first, y: row.getBoundingClientRect().top }
          : undefined,
      };
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
    const leading = previous.leading;
    if (leading) {
      // These are keyed rows from the old DOM. Scan the old order without
      // measuring each row, preferring the previous row on equal distance.
      const { order, index, y } = leading;
      for (
        let distance = 0;
        index - distance >= 0 || index + distance < order.length;
        distance++
      ) {
        const before = order[index - distance];
        const after = order[index + distance];
        if (before && pane.contains(before)) surviving = before;
        else if (after && pane.contains(after)) surviving = after;
        if (surviving) break;
      }
      if (surviving)
        pane.scrollTop += surviving.getBoundingClientRect().top - y;
      else if (pane.querySelector(rowSelector)) pane.scrollTop = 0;
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
        pane.querySelector<HTMLElement>("[data-collection-page]:enabled") ??
        pane.querySelector<HTMLElement>(".panel-state--empty h3[tabindex]") ??
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
