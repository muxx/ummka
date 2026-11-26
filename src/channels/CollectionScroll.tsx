import { Component, type ReactNode, type RefObject } from "react";

type Props = { pane: RefObject<HTMLDivElement | null>; children: ReactNode };
type RowPlace = { id: string; y: number };

export class CollectionScroll extends Component<Props> {
  // Capture the reading position before React changes row or status heights.
  getSnapshotBeforeUpdate(): RowPlace[] {
    const pane = this.props.pane.current;
    if (!pane?.clientHeight) return [];
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
    return [...whole, ...clipped];
  }
  componentDidUpdate(_props: Props, _state: unknown, previous: RowPlace[]) {
    const pane = this.props.pane.current;
    if (!pane) return;
    for (const place of previous) {
      const row = pane.querySelector<HTMLElement>(
        `[data-collection-post="${CSS.escape(place.id)}"]`,
      );
      if (row) {
        pane.scrollTop += row.getBoundingClientRect().top - place.y;
        break;
      }
    }
  }
  render() {
    return (
      <div ref={this.props.pane} className="channels-pane-body collection-rows">
        {this.props.children}
      </div>
    );
  }
}
