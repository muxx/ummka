import type { Bookmark } from "./BookmarkEditor.tsx";
import type { readChannelFilesPage } from "./channel-files-page.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

export type Member = Awaited<
  ReturnType<WorkspaceConnection["readChannelMemberDirectory"]>
>["members"][number];

export type ChannelFile = Awaited<
  ReturnType<typeof readChannelFilesPage>
>["items"][number];

export type RowPlace = {
  offset: number;
  visible: number;
  ids: readonly string[];
  index: number;
};
export type ListPage<Row> = {
  page: number;
  rows: readonly Row[];
  next: number | null;
  inaccessible?: number;
};
export type PageReading<Row> = {
  pages: readonly ListPage<Row>[];
  place: RowPlace;
  query: string;
};
export type BookmarkReading = {
  rows: readonly Bookmark[];
  place: RowPlace;
  writeCheck?: "checking" | "failed";
};
export type ListReadings = ReturnType<typeof createListReadings>;

export function createListReadings() {
  return {
    members: new Map<string, PageReading<Member>>(),
    files: new Map<string, PageReading<ChannelFile>>(),
    bookmarks: new Map<string, BookmarkReading>(),
  };
}

const channelsPerSection = 4;
const retainedPages = 3;
const retainedRows = 40;
const maxRetainedRows = 96;

export function rememberList<Reading>(
  entries: Map<string, Reading>,
  channelId: string,
  reading: Reading,
) {
  entries.delete(channelId);
  entries.set(channelId, reading);
  if (entries.size > channelsPerSection) {
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }
}

export function discardListReadings(
  readings: ListReadings,
  {
    allowed,
    deniedChannel,
    filesAllowed = true,
  }: {
    allowed?: ReadonlySet<string>;
    deniedChannel?: string | null;
    filesAllowed?: boolean;
  },
) {
  if (!filesAllowed) readings.files.clear();
  for (const entries of Object.values(readings)) {
    for (const id of entries.keys()) {
      if (id === deniedChannel || (allowed && !allowed.has(id)))
        entries.delete(id);
    }
  }
}

function nearby<T>(rows: readonly T[], index: number, limit: number) {
  const start = Math.min(
    Math.max(0, index - Math.floor(limit / 2)),
    Math.max(0, rows.length - limit),
  );
  return rows.slice(start, start + limit);
}

export function nearbyRows<Row>(
  rows: readonly Row[],
  place: RowPlace,
  id: (row: Row) => string,
) {
  const index = rows.findIndex((row) => id(row) === place.ids[place.index]);
  const count = Math.min(
    maxRetainedRows,
    Math.max(retainedRows, place.visible + 8),
  );
  const leadingSpace = Math.min(
    Math.floor(count / 2),
    count - place.visible - 4,
  );
  const start = Math.min(
    Math.max(0, index - Math.max(0, leadingSpace)),
    Math.max(0, rows.length - count),
  );
  return rows.slice(start, start + count);
}

export function nearbyPages<Row>(
  pages: readonly ListPage<Row>[],
  place: RowPlace,
  id: (row: Row) => string,
) {
  const leading = place.ids[place.index];
  const index = pages.findIndex((page) =>
    page.rows.some((row) => id(row) === leading),
  );
  const window = nearby(pages, index, retainedPages);
  const keep = new Set(nearbyRows(pageRows(window, id), place, id).map(id));
  return window.map((page) => ({
    ...page,
    rows: page.rows.filter((row) => keep.has(id(row))),
  }));
}

export function pageRows<Row>(
  pages: readonly ListPage<Row>[],
  id: (row: Row) => string,
) {
  const rows = new Map<string, Row>();
  for (const page of pages) for (const row of page.rows) rows.set(id(row), row);
  return [...rows.values()];
}

export function withinPlace(place: RowPlace, ids: readonly string[]): RowPlace {
  const index = ids.indexOf(place.ids[place.index]);
  return { ...place, ids, index: Math.max(0, index) };
}
