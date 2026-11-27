import { expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { openMentionList } from "./mention-list.ts";

const row = (id: string, message: string) => ({
  id,
  channelId: "c".repeat(26),
  message,
});
const page = (
  items: ReturnType<typeof row>[],
  nextPage: number | null,
  firstInaccessiblePostTime = 0,
) => ({ items, nextPage, firstInaccessiblePostTime });

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
  const openRecentMentions = vi.fn(async () => ({ readPage }));
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
    { openRecentMentions: async () => ({ readPage }) },
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
  const openRecentMentions = vi.fn(async () => ({ readPage }));
  const list = openMentionList({ openRecentMentions }, true);
  await list.refresh();
  const abandoned = list.refresh();
  await Promise.resolve();
  expect(list.getSnapshot()).toMatchObject({
    status: "refreshing",
    ...previous,
  });
  list.suspend();
  await list.refresh();
  finish(page([row("b", "late")], null));
  await abandoned;
  expect(list.getSnapshot()).toMatchObject({ status: "network", ...previous });
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
