import { Component, type ReactNode, type RefObject } from "react";

type Rows = readonly { id: string }[];
type Props = {
  scroll: RefObject<HTMLDivElement | null>;
  visible: boolean;
  query: string;
  rows: Rows;
  layout: readonly unknown[];
  children: ReactNode;
};
type Position = {
  scrollTop: number;
  anchor?: { rows: Rows; index: number; offset: number };
};
type Snapshot = { place: Position; hadFocus: boolean };

export function directoryRow(pane: HTMLElement, id: string) {
  return pane.querySelector<HTMLElement>(
    `[data-directory-id="${CSS.escape(id)}"]`,
  );
}

function firstRow(pane: HTMLElement) {
  const rows = pane.querySelector("[data-directory-rows]")?.children;
  if (!rows?.length) return null;
  const top = pane.getBoundingClientRect().top;
  let index = 0;
  let end = rows.length;
  while (index < end) {
    const middle = index + Math.floor((end - index) / 2);
    if (rows[middle].getBoundingClientRect().bottom <= top) index = middle + 1;
    else end = middle;
  }
  const row = rows[index]?.firstElementChild;
  return row instanceof HTMLElement ? { row, index, top } : null;
}

export function directoryFocusFallback(pane: HTMLElement) {
  const first = firstRow(pane);
  return (
    first?.row ?? pane.querySelector<HTMLElement>(".panel-state h3[tabindex]")
  );
}

function capture(pane: HTMLElement, rows: Rows): Position {
  const scrollTop = pane.scrollTop;
  const first = scrollTop > 1 && firstRow(pane);
  if (!first) return { scrollTop };
  const { row, index, top } = first;
  return {
    scrollTop,
    anchor: { rows, index, offset: row.getBoundingClientRect().top - top },
  };
}

function survivingRow(
  pane: HTMLElement,
  anchor: NonNullable<Position["anchor"]>,
  rows: Rows,
) {
  const original = anchor.rows[anchor.index];
  if (!original) return null;
  const row = directoryRow(pane, original.id);
  if (row || rows === anchor.rows) return row;
  const current = new Set(rows.map(({ id }) => id));
  for (let index = anchor.index + 1; index < anchor.rows.length; index++) {
    const { id } = anchor.rows[index];
    if (current.has(id)) return directoryRow(pane, id);
  }
  for (let index = anchor.index - 1; index >= 0; index--) {
    const { id } = anchor.rows[index];
    if (current.has(id)) return directoryRow(pane, id);
  }
  return null;
}

function restore(pane: HTMLElement, place: Position, rows: Rows) {
  pane.scrollTop = place.scrollTop;
  if (!place.anchor) return;
  const row = survivingRow(pane, place.anchor, rows);
  if (row)
    pane.scrollTop +=
      row.getBoundingClientRect().top -
      pane.getBoundingClientRect().top -
      place.anchor.offset;
  else pane.scrollTop = 0;
}

// Read the old layout only before a change to the rendered list or its visibility.
export class DirectoryPosition extends Component<Props> {
  private departure: Position | null = null;
  private unfiltered: Position | null = null;

  getSnapshotBeforeUpdate(previous: Props): Snapshot | null {
    const { rows, query, layout, visible, scroll } = this.props;
    const pane = scroll.current;
    if (
      !previous.visible ||
      !pane ||
      (visible &&
        query === previous.query &&
        rows === previous.rows &&
        layout.every((value, index) =>
          Object.is(value, previous.layout[index]),
        ))
    )
      return null;
    return {
      place: capture(pane, previous.rows),
      hadFocus: pane.contains(document.activeElement),
    };
  }

  componentDidUpdate(
    previous: Props,
    _state: unknown,
    current: Snapshot | null,
  ) {
    const { rows, query, visible, scroll } = this.props;
    const pane = scroll.current;
    if (!pane) return;
    if (!visible) {
      if (current) this.departure = current.place;
      return;
    }
    if (previous.query !== query) {
      if (!previous.query) this.unfiltered = current?.place ?? null;
      if (!query) {
        if (this.unfiltered) restore(pane, this.unfiltered, rows);
        this.unfiltered = null;
      } else pane.scrollTop = 0;
      return;
    }
    const place = current?.place ?? this.departure;
    if (!place) return;
    this.departure = null;
    restore(pane, place, rows);
    if (current?.hadFocus && document.activeElement === document.body)
      directoryFocusFallback(pane)?.focus({ preventScroll: true });
  }

  render() {
    return this.props.children;
  }
}
