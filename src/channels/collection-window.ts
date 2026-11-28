// A warm open may check three previously read server pages. Older and newer
// pages remain reachable through the list boundaries.
export const collectionWindowPages = 3;

export function collectionWindow(
  first: number,
  through: number,
  anchor: number | undefined,
  step: number,
) {
  const width = collectionWindowPages * step;
  const lastStart =
    first +
    Math.max(0, Math.ceil((through - first) / step) - collectionWindowPages) *
      step;
  const page = Math.floor(((anchor ?? first) - first) / step);
  const preferred = first + Math.max(0, page - 1) * step;
  const start = Math.min(preferred, lastStart);
  return { start, through: Math.min(through, start + width) };
}

export type CollectionWindow = ReturnType<typeof collectionWindow>;

export function forgetPostChannel<T extends { channelId: string }>(
  items: T[],
  denied: ReadonlySet<string>,
) {
  return denied.size
    ? items.filter(({ channelId }) => !denied.has(channelId))
    : items;
}
