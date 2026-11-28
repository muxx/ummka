import { expect, test, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { openRecentMentions } from "../mattermost/recent-mentions.ts";
import { openMentionList } from "./mention-list.ts";

const row = (id: string, message: string) => ({
  id,
  channelId: "c".repeat(26),
  message,
  cards: [],
});
const page = (
  items: ReturnType<typeof row>[],
  nextPage: number | null,
  firstInaccessiblePostTime = 0,
  raw = nextPage === null ? 0 : nextPage - 1,
) => ({ page: raw, items, nextPage, firstInaccessiblePostTime });

test("keeps the signed cursor across skipped pages, a retry and duplicate posts; clears rows on denied access", async () => {
  const readPage = vi
    .fn()
    .mockResolvedValueOnce(page([row("a", "first")], 3, 53))
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(
      page([row("a", "updated"), row("b", "second")], 5, 12),
    )
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 403 })),
    );
  const openRecentMentions = vi.fn(async () => ({
    readPage,
    filterKey: "mentions",
  }));
  const list = openMentionList({ openRecentMentions }, true);
  await list.refresh();
  await list.load();
  expect(list.getSnapshot()).toMatchObject({
    status: "ready",
    edge: "network",
    items: [row("a", "first")],
    nextPage: 3,
  });
  await list.load();
  expect(list.getSnapshot()).toMatchObject({
    items: [row("a", "updated"), row("b", "second")],
    nextPage: 5,
    firstInaccessiblePostTime: 53,
  });
  await list.load();
  expect(list.getSnapshot()).toMatchObject({
    status: "forbidden",
    items: [],
    nextPage: null,
    firstInaccessiblePostTime: 0,
  });
  await list.load();
  expect(readPage.mock.calls.map(([pageNumber]) => pageNumber)).toEqual([
    0, 3, 3, 5,
  ]);
  expect(openRecentMentions).toHaveBeenCalledExactlyOnceWith(
    true,
    expect.any(AbortSignal),
  );
});

test("coalesces a pending initial read and ignores the result of a closed account view", async () => {
  let finish!: (value: ReturnType<typeof page>) => void;
  const pending = new Promise<ReturnType<typeof page>>((resolve) => {
    finish = resolve;
  });
  const readPage = vi.fn(() => pending);
  const list = openMentionList(
    { openRecentMentions: async () => ({ readPage, filterKey: "mentions" }) },
    false,
  );
  const changed = vi.fn();
  list.subscribe(changed);
  const first = list.load();
  await list.load();
  expect(readPage).toHaveBeenCalledTimes(1);
  list.close();
  const changes = changed.mock.calls.length;
  finish(page([row("c", "late reply")], null));
  await first;
  expect(changed).toHaveBeenCalledTimes(changes);
  expect(list.getSnapshot().items).toHaveLength(0);
});

test("reopening uses the last answer and the new query ignores a closed response", async () => {
  const previous = page([row("a", "previous")], 2);
  let finish!: (value: typeof previous) => void;
  const readPage = vi
    .fn()
    .mockResolvedValueOnce(previous)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(page([], null));
  const openRecentMentions = vi.fn(async () => ({
    readPage,
    filterKey: "mentions",
  }));
  const list = openMentionList({ openRecentMentions }, true);
  await list.refresh();
  const abandoned = list.refresh();
  await Promise.resolve();
  expect(list.getSnapshot()).toMatchObject({
    status: "refreshing",
    items: previous.items,
    nextPage: previous.nextPage,
  });
  list.suspend();
  await list.refresh();
  finish(page([row("b", "late")], null));
  await abandoned;
  expect(list.getSnapshot()).toMatchObject({
    status: "network",
    items: previous.items,
    nextPage: previous.nextPage,
  });
  await list.refresh();
  expect(list.getSnapshot()).toMatchObject({
    status: "ready",
    hasResponse: true,
    items: [],
    nextPage: null,
  });
  expect(readPage.mock.calls.map(([pageNumber]) => pageNumber)).toEqual([
    0, 0, 0, 0,
  ]);
});

test("ordinary mention refresh bounds its exact scan, prepends newer unique rows, and discards old filter data", async () => {
  const rows = Array.from({ length: 9 }, (_, n) =>
    row(String(n), `mention ${n}`),
  );
  type Reader = Awaited<
    ReturnType<Parameters<typeof openMentionList>[0]["openRecentMentions"]>
  >;
  const readPage = vi
    .fn<Reader["readPage"]>()
    .mockImplementation(async (n) => page([rows[n]], n + 1));
  let filterKey = "old";
  const list = openMentionList(
    { openRecentMentions: async () => ({ readPage, filterKey }) },
    false,
  );
  await list.revalidate();
  for (let i = 1; i <= 6; i++) await list.load();
  list.suspend();
  list.retainReading(rows[5].id);
  const before = list.getSnapshot().items;
  expect(before).toEqual(rows.slice(4, 7));
  readPage
    .mockClear()
    .mockResolvedValueOnce(page([{ ...rows[4], message: "Edited" }], 5));
  const update = list.revalidate(rows[5].id);
  expect(list.getSnapshot()).toMatchObject({
    status: "refreshing",
    items: before,
  });
  await update;
  expect(readPage.mock.calls.map(([n, _signal, bound]) => [n, bound])).toEqual([
    [4, 7],
    [5, 7],
    [6, 7],
  ]);
  expect(list.getSnapshot()).toMatchObject({
    items: [{ ...rows[4], message: "Edited" }, rows[5], rows[6]],
    newer: "available",
    nextPage: 7,
  });
  readPage.mockResolvedValueOnce(page([rows[3], rows[4]], 4));
  await list.loadNewer();
  await list.load();
  expect(list.getSnapshot().items.map(({ id }) => id)).toEqual([
    "3",
    "4",
    "5",
    "6",
    "7",
  ]);
  list.suspend();
  list.retainReading(rows[5].id);
  readPage.mockClear().mockImplementation(async (n) => page([], n + 1));
  await list.revalidate(rows[5].id);
  expect(list.getSnapshot()).toMatchObject({
    items: [],
    newer: "available",
    nextPage: 7,
    manualPage: true,
  });
  list.suspend();
  readPage.mockClear();
  await list.revalidate();
  expect(readPage.mock.calls.map(([raw]) => raw)).toEqual([4, 5, 6]);
  expect(list.getSnapshot()).toMatchObject({
    items: [],
    newer: "available",
    nextPage: 7,
    manualPage: true,
  });
  await list.load();
  expect(readPage.mock.calls.map(([n, _signal, bound]) => [n, bound])).toEqual([
    [4, 7],
    [5, 7],
    [6, 7],
    [7, 8],
  ]);
  expect(list.getSnapshot()).toMatchObject({
    items: [],
    newer: "available",
    nextPage: 8,
    manualPage: true,
  });
  let finish!: (result: ReturnType<typeof page>) => void;
  readPage.mockClear().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  filterKey = "changed";
  const changed = list.revalidate(rows[5].id);
  await vi.waitFor(() =>
    expect(list.getSnapshot()).toMatchObject({ status: "loading", items: [] }),
  );
  expect(readPage.mock.calls.map(([n]) => n)).toEqual([0]);
  finish(page([], null));
  await changed;
  list.suspend();
  expect(list.getSnapshot()).toMatchObject({
    status: "ready",
    hasResponse: true,
    items: [],
    nextPage: null,
  });
});

test.each([4, 5])(
  "the signed reader retains the true terminal raw page %i after skipped results",
  async (terminal) => {
    const userId = "u".repeat(26);
    const config = new Configuration({
      basePath: "https://example.test",
      fetchApi: async () =>
        Response.json({
          id: userId,
          username: "reader",
          notify_props: {
            mention_keys: "",
            channel: "false",
            first_name: "false",
          },
        }),
    });
    const search = {
      readPostSearchPage: vi.fn(async ({ page }: { page: number }) => ({
        items:
          page === 5
            ? []
            : [
                row(
                  String(page),
                  page === 0 || page === 4 ? "@reader match" : "not a mention",
                ),
              ],
        isEnd: page === terminal,
        matches: null,
        firstInaccessiblePostTime: 0,
      })),
    };
    const list = openMentionList(
      {
        openRecentMentions: (archived, signal) =>
          openRecentMentions(config, userId, search, archived, signal),
      },
      false,
    );
    await list.revalidate();
    await list.load();
    if (terminal === 5) await list.load();
    expect(list.getSnapshot().items.map(({ id }) => id)).toEqual(["0", "4"]);
    expect(
      search.readPostSearchPage.mock.calls.map(([query]) => query.page),
    ).toEqual(Array.from({ length: terminal + 1 }, (_, n) => n));
    list.suspend();
    list.retainReading("4");
    search.readPostSearchPage.mockClear();
    await list.revalidate("4");
    expect(
      search.readPostSearchPage.mock.calls.map(([query]) => query.page),
    ).toEqual([terminal - 2, terminal - 1, terminal]);
    expect(list.getSnapshot()).toMatchObject({
      items: [row("4", "@reader match")],
      nextPage: null,
      newer: "available",
    });
  },
);

test("a confirmed channel denial removes old and late mentions from that channel only", async () => {
  const privateRoom = row("a", "old private mention");
  const publicRoom = {
    ...row("b", "public mention"),
    channelId: "d".repeat(26),
  };
  let finish!: (value: ReturnType<typeof page>) => void;
  const readPage = vi
    .fn()
    .mockResolvedValueOnce(page([privateRoom, publicRoom], null))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const list = openMentionList(
    { openRecentMentions: async () => ({ readPage, filterKey: "mentions" }) },
    false,
  );
  await list.revalidate();
  const refreshing = list.revalidate(privateRoom.id);
  await vi.waitFor(() => expect(finish).toBeDefined());
  list.setChannelDenied(privateRoom.channelId, true);
  expect(list.getSnapshot().items).toEqual([publicRoom]);
  finish(page([{ ...privateRoom, message: "late leak" }, publicRoom], null));
  await refreshing;
  expect(list.getSnapshot().items).toEqual([publicRoom]);
  readPage.mockResolvedValueOnce(page([privateRoom, publicRoom], null));
  list.setChannelDenied(privateRoom.channelId, false);
  await list.revalidate();
  expect(list.getSnapshot().items).toEqual([privateRoom, publicRoom]);
});
