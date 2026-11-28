import { expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import {
  availableDirectoryChannels,
  openChannelDirectoryList,
} from "./open-channel-directory.ts";

const teamId = "t".repeat(26);
function row(index: number) {
  return {
    id: String(index).padStart(26, "a"),
    kind: "O",
    name: `room-${index}`,
    displayName: `Room ${index}`,
    purpose: "",
    deleteAt: 0,
  };
}
const firstPage = Array.from({ length: 50 }, (_, i) => row(i));

test("an entirely joined page still advances, overlaps update their original position", async () => {
  const readChannelDirectoryPage = vi
    .fn()
    .mockResolvedValueOnce({ items: firstPage, hasMore: true })
    .mockResolvedValueOnce({
      items: [{ ...row(45), displayName: "Updated" }, row(50)],
      hasMore: false,
    });
  const list = openChannelDirectoryList(
    { readChannelDirectoryPage },
    teamId,
    "public",
  );
  await list.more();
  const joined = new Set(firstPage.map((c) => c.id));
  expect(availableDirectoryChannels(list.getSnapshot().items, joined)).toEqual(
    [],
  );
  expect(list.getSnapshot().hasMore).toBe(true);
  await list.more();
  expect(list.getSnapshot().items).toHaveLength(51);
  expect(list.getSnapshot().items[45].displayName).toBe("Updated");
  expect(availableDirectoryChannels(list.getSnapshot().items, joined)).toEqual([
    row(50),
  ]);
  joined.add(row(50).id);
  expect(availableDirectoryChannels(list.getSnapshot().items, joined)).toEqual(
    [],
  );
  await list.more();
  expect(
    readChannelDirectoryPage.mock.calls.map(([query]) => query.page),
  ).toEqual([0, 1]);
});

test("callbacks and scroll events share the read; only explicit retry repeats the failed page", async () => {
  const readChannelDirectoryPage = vi
    .fn()
    .mockResolvedValueOnce({ items: firstPage, hasMore: true })
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce({ items: [], hasMore: false });
  const list = openChannelDirectoryList(
    { readChannelDirectoryPage },
    teamId,
    "public",
  );
  let nested: ReturnType<typeof list.more>;
  const unsubscribe = list.subscribe(() => {
    if (list.getSnapshot().status === "loading") nested = list.more();
  });
  const initial = list.more();
  expect(initial).toBe(nested);
  expect(initial).toBe(list.more());
  await initial;
  await list.more();
  expect(list.getSnapshot()).toMatchObject({
    status: "network",
    items: firstPage,
  });
  await list.more();
  expect(readChannelDirectoryPage).toHaveBeenCalledTimes(2);
  await list.retry();
  expect(
    readChannelDirectoryPage.mock.calls.map(([query]) => query.page),
  ).toEqual([0, 1, 1]);
  expect(list.getSnapshot()).toMatchObject({
    status: "ready",
    items: firstPage,
    hasMore: false,
  });
  unsubscribe();
  list.close();
});

test.each([
  [401, "unauthorized"],
  [403, "forbidden"],
  [404, "forbidden"],
] as const)("a %i clears accumulated names", async (code, status) => {
  const readChannelDirectoryPage = vi
    .fn()
    .mockResolvedValueOnce({ items: firstPage, hasMore: true })
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: code })),
    );
  const list = openChannelDirectoryList(
    { readChannelDirectoryPage },
    teamId,
    "archived",
  );
  await list.more();
  await list.more();
  expect(list.getSnapshot()).toEqual({
    status,
    items: [],
    hasResponse: false,
    hasMore: false,
  });
  await list.more();
  await list.retry();
  expect(readChannelDirectoryPage).toHaveBeenCalledTimes(2);
});
test("closing before dispatch or while reading discards the result", async () => {
  let finish!: (answer: {
    items: ReturnType<typeof row>[];
    hasMore: boolean;
  }) => void;
  const readChannelDirectoryPage = vi.fn(
    () =>
      new Promise<{ items: ReturnType<typeof row>[]; hasMore: boolean }>(
        (resolve) => {
          finish = resolve;
        },
      ),
  );
  const first = openChannelDirectoryList(
    { readChannelDirectoryPage },
    teamId,
    "public",
  );
  const before = first.more();
  first.close();
  await before;
  expect(readChannelDirectoryPage).not.toHaveBeenCalled();
  const other = openChannelDirectoryList(
    { readChannelDirectoryPage },
    teamId,
    "public",
  );
  const waiting = other.more();
  await Promise.resolve();
  other.close();
  finish({ items: firstPage, hasMore: true });
  await waiting;
  expect(other.getSnapshot()).toEqual({
    items: [],
    hasMore: false,
    status: "closed",
    hasResponse: false,
  });
});

test("return refreshes only the confirmed range and publishes it atomically", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ items: [row(0)], hasMore: true })
    .mockResolvedValueOnce({ items: [row(1)], hasMore: true })
    .mockResolvedValueOnce({ items: [row(2)], hasMore: true });
  let answer!: (value: {
    items: ReturnType<typeof row>[];
    hasMore: boolean;
  }) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const list = openChannelDirectoryList(
    { readChannelDirectoryPage: read },
    teamId,
    "public",
  );
  await list.more();
  await list.more();
  const refresh = list.refresh();
  await Promise.resolve();
  await Promise.resolve();
  expect(list.getSnapshot()).toMatchObject({
    status: "refreshing",
    hasResponse: true,
    items: [row(0), row(1)],
  });
  expect(list.more()).toBe(refresh);
  expect(list.refresh()).toBe(refresh);
  answer({ items: [row(3)], hasMore: true });
  await refresh;
  expect(list.getSnapshot()).toMatchObject({
    status: "ready",
    items: [row(2), row(3)],
    hasMore: true,
  });
  expect(read.mock.calls.map(([query]) => query.page)).toEqual([0, 1, 0, 1]);
});

test("aborted refresh cannot replace a confirmed empty snapshot or a newer denial", async () => {
  let answer!: (value: {
    items: ReturnType<typeof row>[];
    hasMore: boolean;
  }) => void;
  const read = vi
    .fn()
    .mockResolvedValueOnce({ items: [], hasMore: false })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    )
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 403 })),
    );
  const list = openChannelDirectoryList(
    { readChannelDirectoryPage: read },
    teamId,
    "public",
  );
  await list.more();
  const old = list.refresh();
  await Promise.resolve();
  list.pause();
  expect(read.mock.calls[1][1].aborted).toBe(true);
  expect(list.getSnapshot()).toMatchObject({
    status: "ready",
    hasResponse: true,
    items: [],
  });
  await list.refresh();
  answer({ items: [row(9)], hasMore: false });
  await old;
  expect(list.getSnapshot()).toMatchObject({
    status: "forbidden",
    hasResponse: false,
    items: [],
  });
});
