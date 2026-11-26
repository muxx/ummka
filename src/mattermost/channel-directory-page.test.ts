import { expect, test, vi } from "vitest";
import type { Channel } from "../../vendor/mattermost/index.js";
import {
  readChannelDirectoryPage,
  searchChannelDirectory,
} from "./channel-directory-page.ts";

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

test("search preserves server order and archive state without claiming membership", async () => {
  const rows = [
    row(3),
    { ...row(2), type: "P", deleteAt: 42 },
    { ...row(1), type: "P" },
  ];
  const search = vi.fn(async () => rows);
  const signal = new AbortController().signal;
  const items = await searchChannelDirectory(
    { autocompleteChannelsForTeam: search },
    teamId,
    "  тест +&  ",
    signal,
  );
  expect(search).toHaveBeenCalledExactlyOnceWith(
    { teamId, name: "тест +&" },
    { signal },
  );
  expect(items.map((item) => [item.id, item.kind, item.deleteAt])).toEqual([
    [rows[0].id, "O", 0],
    [rows[1].id, "P", 42],
    [rows[2].id, "P", 0],
  ]);
});
test("search accepts an empty or full response and rejects an oversized, mixed-team or duplicate response", async () => {
  const read = (rows: Channel[]) =>
    searchChannelDirectory(
      { autocompleteChannelsForTeam: async () => rows },
      teamId,
      "test",
    );
  await expect(read([])).resolves.toEqual([]);
  await expect(
    read(Array.from({ length: 50 }, (_, i) => row(i))),
  ).resolves.toHaveLength(50);
  await expect(
    read(Array.from({ length: 51 }, (_, i) => row(i))),
  ).rejects.toThrow();
  await expect(
    read([row(0), { ...row(1), teamId: "z".repeat(26) }]),
  ).rejects.toThrow();
  await expect(read([row(0), row(0)])).rejects.toThrow();
});
test("an invalid or cancelled directory search does not dispatch and a late response is discarded", async () => {
  const controller = new AbortController();
  const search = vi.fn(async () => {
    controller.abort();
    return [row(0)];
  });
  const api = { autocompleteChannelsForTeam: search };
  await expect(searchChannelDirectory(api, teamId, "   ")).rejects.toThrow();
  await expect(searchChannelDirectory(api, "", "ok")).rejects.toThrow();
  expect(search).not.toHaveBeenCalled();
  await expect(
    searchChannelDirectory(api, teamId, "ok", controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    searchChannelDirectory(api, teamId, "ok", controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(search).toHaveBeenCalledTimes(1);
  const refusal = new Error("refused");
  search.mockRejectedValueOnce(refusal);
  await expect(searchChannelDirectory(api, teamId, "ok")).rejects.toBe(refusal);
});

test("directory pages and name matches carry only a supplied text topic", async () => {
  const raw = [
    { ...row(1), header: "Release items" },
    { ...row(2), header: "" },
  ];
  const page = await readChannelDirectoryPage(api(raw), query);
  const search = await searchChannelDirectory(
    { autocompleteChannelsForTeam: async () => raw },
    teamId,
    "design",
  );
  expect(search).toEqual(page.items);
  expect(search[0].header).toBe("Release items");
  expect(search[1]).not.toHaveProperty("header");
  await expect(
    readChannelDirectoryPage(
      api([{ ...row(1), header: 42 as unknown as string }]),
      query,
    ),
  ).rejects.toThrow(TypeError);
});
