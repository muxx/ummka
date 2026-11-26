import { afterEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { openDirectorySearch } from "./open-directory-search.ts";

const teamId = "t".repeat(26);
const row = {
  id: "r".repeat(26),
  name: "release",
  displayName: "Release",
  kind: "O",
  purpose: "",
  deleteAt: 0,
};
afterEach(() => vi.useRealTimers());

test("only the last trimmed query is sent after 100 ms, preserving interior text", async () => {
  vi.useFakeTimers();
  const searchChannelDirectory = vi.fn(async () => [row]);
  const search = openDirectorySearch({ searchChannelDirectory }, teamId);
  search.setQuery("rel");
  await vi.advanceTimersByTimeAsync(99);
  search.setQuery("  releases + ui  ");
  await vi.advanceTimersByTimeAsync(60);
  search.setQuery("releases + ui");
  await vi.advanceTimersByTimeAsync(39);
  expect(searchChannelDirectory).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(searchChannelDirectory).toHaveBeenCalledExactlyOnceWith(
    teamId,
    "releases + ui",
    expect.any(AbortSignal),
  );
  expect(search.getSnapshot()).toEqual({
    query: "releases + ui",
    status: "ready",
    items: [row],
  });
  search.setQuery(" ");
  expect(search.getSnapshot()).toEqual({
    query: "",
    status: "idle",
    items: [],
  });
  search.close();
});

test("a replacement hides old rows and only the current request can update them", async () => {
  vi.useFakeTimers();
  let finish!: (rows: (typeof row)[]) => void;
  const searchChannelDirectory = vi.fn(
    async (_team: string, query: string, _signal?: AbortSignal) => {
      if (query === "late")
        return new Promise<(typeof row)[]>((resolve) => {
          finish = resolve;
        });
      return query === "match" ? [row] : [];
    },
  );
  const search = openDirectorySearch({ searchChannelDirectory }, teamId);
  search.setQuery("match");
  await vi.advanceTimersByTimeAsync(100);
  search.setQuery("late");
  expect(search.getSnapshot().items).toEqual([]);
  await vi.advanceTimersByTimeAsync(100);
  const old = searchChannelDirectory.mock.calls[1][2];
  search.setQuery("absent");
  expect(old?.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(100);
  finish([row]);
  await Promise.resolve();
  expect(search.getSnapshot()).toEqual({
    query: "absent",
    items: [],
    status: "ready",
  });
  search.close();
});

test("clearing or closing cancels the timer, and a closed team ignores future input", async () => {
  vi.useFakeTimers();
  const searchChannelDirectory = vi.fn(async () => [row]);
  const search = openDirectorySearch({ searchChannelDirectory }, teamId);
  search.setQuery("one");
  search.setQuery("");
  await vi.advanceTimersByTimeAsync(100);
  search.setQuery("two");
  search.close();
  search.setQuery("three");
  await vi.advanceTimersByTimeAsync(100);
  expect(searchChannelDirectory).not.toHaveBeenCalled();
  expect(search.getSnapshot()).toEqual({
    query: "",
    status: "closed",
    items: [],
  });
});

test("network failure waits for explicit retry, loss of access and an empty result stay distinct", async () => {
  vi.useFakeTimers();
  const searchChannelDirectory = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 403 })),
    )
    .mockResolvedValueOnce([]);
  const search = openDirectorySearch({ searchChannelDirectory }, teamId);
  search.setQuery("room");
  await vi.advanceTimersByTimeAsync(100);
  expect(search.getSnapshot().status).toBe("network");
  search.setQuery(" room ");
  await vi.advanceTimersByTimeAsync(200);
  expect(searchChannelDirectory).toHaveBeenCalledTimes(1);
  await Promise.all([search.retry(), search.retry()]);
  expect(search.getSnapshot()).toEqual({
    query: "room",
    status: "forbidden",
    items: [],
  });
  await search.retry();
  expect(searchChannelDirectory).toHaveBeenCalledTimes(2);
  search.setQuery("other");
  await vi.advanceTimersByTimeAsync(100);
  expect(search.getSnapshot()).toEqual({
    query: "other",
    status: "ready",
    items: [],
  });
  search.close();
});

test("closing an in-flight team cannot publish its late successful rows", async () => {
  vi.useFakeTimers();
  let done!: (rows: (typeof row)[]) => void;
  const searchChannelDirectory = vi.fn(
    () =>
      new Promise<(typeof row)[]>((resolve) => {
        done = resolve;
      }),
  );
  const search = openDirectorySearch({ searchChannelDirectory }, teamId);
  const changed = vi.fn();
  search.subscribe(changed);
  search.setQuery("room");
  await vi.advanceTimersByTimeAsync(100);
  search.close();
  done([row]);
  await Promise.resolve();
  await Promise.resolve();
  expect(search.getSnapshot().status).toBe("closed");
  expect(changed).toHaveBeenCalledTimes(2);
});
