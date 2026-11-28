import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ListPage, PageReading } from "./channel-list-reading.ts";
import { useChannelListPages } from "./use-channel-list-pages.ts";

function start(pages: number[]) {
  const channelId = "channel";
  const load = vi.fn(
    async (page: number): Promise<ListPage<string>> => ({
      page,
      rows: [`row-${page}`],
      next: page + 1,
    }),
  );
  const history = new Map<string, PageReading<string>>([
    [
      channelId,
      {
        query: "",
        pages: pages.map((page) => ({
          page,
          rows: [`cached-${page}`],
          next: page + 1,
        })),
        place: {
          ids: pages.map((page) => `cached-${page}`),
          offset: 0,
          index: 0,
          visible: 1,
        },
      },
    ],
  ]);
  const { result } = renderHook(() =>
    useChannelListPages({
      history,
      channelId,
      online: true,
      load,
      id: String,
      sessionIssue: vi.fn(),
    }),
  );
  const ready = () =>
    waitFor(() => expect(result.current.state.status).toBe("ready"));
  return { result, load, ready };
}

test("drops contradicted deep rows as soon as a terminal empty prepend arrives and retries only the first page", async () => {
  const { result, load, ready } = start([4, 5, 6]);
  await ready();
  let failHead!: (cause: Error) => void;
  load.mockResolvedValueOnce({ page: 3, rows: [], next: null });
  load.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        failHead = reject;
      }),
  );
  act(() => result.current.more(3));
  await waitFor(() =>
    expect(load.mock.calls.map(([page]) => page)).toEqual([4, 5, 6, 3, 0]),
  );
  expect(result.current.rows).toEqual([]);
  expect(result.current.state.status).toBe("loading");
  await act(async () => failHead(new Error("offline")));
  expect(result.current.state.status).toBe("failed");
  expect(result.current.rows).toEqual([]);
  load.mockResolvedValueOnce({ page: 0, rows: ["fresh"], next: 1 });
  act(() => result.current.retry());
  await ready();
  expect(result.current.rows).toEqual(["fresh"]);
  expect(result.current.before).toBeNull();
  expect(result.current.next).toBe(1);
  expect(load.mock.calls.map(([page]) => page)).toEqual([4, 5, 6, 3, 0, 0]);
});

test("uses a nonempty terminal prepend as the last page and keeps its earlier neighbor available", async () => {
  const { result, load, ready } = start([4, 5, 6]);
  await ready();
  load.mockResolvedValueOnce({ page: 3, rows: ["new ending"], next: null });
  act(() => result.current.more(3));
  await ready();
  expect(result.current.rows).toEqual(["new ending"]);
  expect(result.current.before).toBe(2);
  expect(result.current.next).toBeNull();
  expect(load.mock.calls.map(([page]) => page)).toEqual([4, 5, 6, 3]);
  act(() => result.current.more(2));
  await ready();
  expect(result.current.rows).toEqual(["row-2", "new ending"]);
  expect(result.current.before).toBe(1);
  expect(result.current.next).toBeNull();
});

test("keeps the preceding exact-full pages when a following empty page confirms the end", async () => {
  const { result, load, ready } = start([0, 1, 2]);
  await ready();
  load.mockResolvedValueOnce({ page: 3, rows: [], next: null });
  act(() => result.current.more(3));
  await ready();
  expect(result.current.rows).toEqual(["row-0", "row-1", "row-2"]);
  expect(result.current.next).toBeNull();
  expect(load.mock.calls.map(([page]) => page)).toEqual([0, 1, 2, 3]);
});
