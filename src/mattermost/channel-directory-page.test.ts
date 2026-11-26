import { expect, test, vi } from "vitest";
import type { Channel } from "../../vendor/mattermost/index.js";
import { readChannelDirectoryPage } from "./channel-directory-page.ts";

const teamId = "t".repeat(26);
const query = { teamId, page: 0, kind: "public" } as const;
function row(index: number): Channel {
  return {
    id: String(index).padStart(26, "a"),
    type: "O",
    teamId,
    deleteAt: 0,
    name: "design",
    displayName: "Дизайн",
    purpose: "Макеты",
  };
}
function api(rows: Channel[] = []) {
  return {
    getPublicChannelsForTeam: vi.fn(async () => rows),
    getDeletedChannelsForTeam: vi.fn(async () => rows),
  };
}
test("a full page preserves server order and leaves the next page available", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => row(60 - i));
  const channels = api(rows);
  const signal = new AbortController().signal;
  const result = await readChannelDirectoryPage(
    channels,
    { ...query, page: 2 },
    signal,
  );
  expect(result.hasMore).toBe(true);
  expect(result.items.map((item) => item.id)).toEqual(
    rows.map((item) => item.id),
  );
  expect(channels.getPublicChannelsForTeam).toHaveBeenCalledExactlyOnceWith(
    { teamId, page: 2, perPage: 50 },
    { signal },
  );
  expect(channels.getDeletedChannelsForTeam).not.toHaveBeenCalled();
  expect(await readChannelDirectoryPage(api(), query)).toEqual({
    items: [],
    hasMore: false,
  });
});
test("both kinds of archived rooms retain their deletion time", async () => {
  const rows = [
    { ...row(1), type: "P", deleteAt: 5, purpose: undefined },
    { ...row(2), deleteAt: 3 },
  ];
  const channels = api(rows);
  const result = await readChannelDirectoryPage(channels, {
    ...query,
    kind: "archived",
  });
  expect(result).toEqual({
    items: [
      {
        id: rows[0].id,
        kind: "P",
        name: "design",
        displayName: "Дизайн",
        purpose: "",
        deleteAt: 5,
      },
      {
        id: rows[1].id,
        kind: "O",
        name: "design",
        displayName: "Дизайн",
        purpose: "Макеты",
        deleteAt: 3,
      },
    ],
    hasMore: false,
  });
  expect(channels.getPublicChannelsForTeam).not.toHaveBeenCalled();
});
test.each([
  { teamId: "bad" },
  { page: -1 },
  { page: 0.5 },
  { page: Number.MAX_SAFE_INTEGER },
  { kind: "private" as "public" },
])("invalid directory request %j does not dispatch", async (change) => {
  const channels = api();
  await expect(
    readChannelDirectoryPage(channels, { ...query, ...change }),
  ).rejects.toThrow();
  expect(channels.getPublicChannelsForTeam).not.toHaveBeenCalled();
  expect(channels.getDeletedChannelsForTeam).not.toHaveBeenCalled();
});
test.each([
  { teamId: "u".repeat(26) },
  { type: "D" },
  { type: "P" },
  { deleteAt: 1 },
  { id: "" },
  { displayName: "" },
  { name: "" },
  { deleteAt: NaN },
  { purpose: 3 as unknown as string },
])(
  "one malformed or unrelated row rejects the whole page %j",
  async (change) => {
    await expect(
      readChannelDirectoryPage(api([row(1), { ...row(2), ...change }]), query),
    ).rejects.toThrow("entry");
  },
);
test("rejects duplicates, oversized pages and a live room in archives", async () => {
  await expect(
    readChannelDirectoryPage(api([row(1), row(1)]), query),
  ).rejects.toThrow("entry");
  await expect(
    readChannelDirectoryPage(
      api(Array.from({ length: 51 }, (_, i) => row(i))),
      query,
    ),
  ).rejects.toThrow("page");
  await expect(
    readChannelDirectoryPage(api([row(1)]), { ...query, kind: "archived" }),
  ).rejects.toThrow("entry");
});
test("preserves a transport refusal and discards a response after cancellation", async () => {
  const channels = api();
  const refusal = new Error("forbidden");
  channels.getPublicChannelsForTeam.mockRejectedValueOnce(refusal);
  await expect(readChannelDirectoryPage(channels, query)).rejects.toBe(refusal);
  const controller = new AbortController();
  channels.getPublicChannelsForTeam.mockImplementationOnce(async () => {
    controller.abort();
    return [row(1)];
  });
  await expect(
    readChannelDirectoryPage(channels, query, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  const closed = api();
  await expect(
    readChannelDirectoryPage(closed, query, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(closed.getPublicChannelsForTeam).not.toHaveBeenCalled();
});
