import { Component, type ReactNode, type RefObject } from "react";
import type { RowPlace } from "./channel-list-reading.ts";

const rowSelector = "[data-channel-list-row]";

function firstVisible(
  rows: NodeListOf<HTMLElement>,
  before: (bounds: DOMRect) => boolean,
) {
  let index = 0;
  let end = rows.length;
  while (index < end) {
    const middle = index + Math.floor((end - index) / 2);
    if (before(rows[middle].getBoundingClientRect())) index = middle + 1;
    else end = middle;
  }
  return index;
}

function capture(pane: HTMLElement): RowPlace {
  const rows = pane.querySelectorAll<HTMLElement>(rowSelector);
  const { top, bottom } = pane.getBoundingClientRect();
  const index = firstVisible(rows, (bounds) => bounds.bottom <= top);
  const through = firstVisible(rows, (bounds) => bounds.top < bottom);
  const row = rows[index];
  return {
    offset: row ? row.getBoundingClientRect().top - top : 0,
    ids: Array.from(rows, (entry) => entry.dataset.channelListRow ?? ""),
    visible: Math.max(0, through - index),
    index,
  };
}

function restore(pane: HTMLElement, place: RowPlace) {
  const rows = new Map(
    Array.from(pane.querySelectorAll<HTMLElement>(rowSelector), (row) => [
      row.dataset.channelListRow,
      row,
    ]),
  );
  let target = rows.get(place.ids[place.index]);
  for (let delta = 1; !target && delta < place.ids.length; delta++)
    target =
      rows.get(place.ids[place.index + delta]) ??
      rows.get(place.ids[place.index - delta]);
  if (!target) {
    pane.scrollTop = 0;
    return;
  }
  pane.scrollTop +=
    target.getBoundingClientRect().top -
    pane.getBoundingClientRect().top -
    place.offset;
}

type Props = {
  scroll: RefObject<HTMLElement | null>;
  rows: unknown;
  heading: RefObject<HTMLHeadingElement | null>;
  leadingControl?: boolean;
  query?: string;
  hidden?: boolean;
  start?: RowPlace;
  remember: (place: RowPlace) => void;
  children: ReactNode;
};

type Snapshot = { place: RowPlace; focused: Element | null };

export class ChannelListPosition extends Component<
  Props,
  object,
  Snapshot | null
> {
  private suspended?: RowPlace;

  componentDidMount() {
    const { scroll, start } = this.props;
    if (scroll.current && start) restore(scroll.current, start);
  }

  getSnapshotBeforeUpdate(previous: Props): Snapshot | null {
    const { scroll, rows, hidden, leadingControl } = this.props;
    const pane = scroll.current;
    if (
      !pane ||
      previous.hidden ||
      (previous.rows === rows &&
        hidden === previous.hidden &&
        leadingControl === previous.leadingControl)
    )
      return null;
    const active = document.activeElement;
    return {
      place: capture(pane),
      focused:
        active?.closest(rowSelector) && pane.contains(active) ? active : null,
    };
  }

  componentDidUpdate(
    previous: Props,
    _state: unknown,
    snapshot: Snapshot | null,
  ) {
    const { hidden, scroll, query, heading } = this.props;
    const pane = scroll.current;
    if (!pane) return;
    if (hidden) {
      if (snapshot) this.suspended = snapshot.place;
      return;
    }
    const anchor = snapshot?.place ?? this.suspended;
    if (previous.query !== query) pane.scrollTop = 0;
    else if (anchor) restore(pane, anchor);
    this.suspended = undefined;
    if (
      snapshot?.focused &&
      !snapshot.focused.isConnected &&
      document.activeElement === document.body
    )
      heading.current?.focus({ preventScroll: true });
  }

  componentWillUnmount() {
    const pane = this.props.scroll.current;
    if (pane && !this.props.hidden) this.props.remember(capture(pane));
    else if (this.suspended) this.props.remember(this.suspended);
  }

  render() {
    return this.props.children;
  }
}
