import { expect, test, vi } from "vitest";
import { Configuration, PostsApi } from "../../vendor/mattermost/index.js";
import {
  type ChannelRefreshResult,
  refreshChannelHistory,
} from "./channel-history-refresh.ts";

const channelId = "c".repeat(26),
  id = "p".repeat(26);
const request = { kind: "latest", channelId, collapsedThreads: false } as const;
function response() {
  return Response.json({
    order: [id],
    posts: {
      [id]: {
        id,
        channel_id: channelId,
        user_id: "u".repeat(26),
        root_id: "",
        create_at: 10,
        update_at: 10,
        edit_at: 0,
        delete_at: 0,
        type: "",
        message: "content",
        hashtags: "",
        is_pinned: false,
      },
    },
    prev_post_id: "",
    next_post_id: "",
  });
}
function setup(fetchApi: typeof fetch) {
  const api = new PostsApi(
    new Configuration({ basePath: "https://team.example.test", fetchApi }),
  );
  const writer = {
    begin: vi.fn(async (_channel: string) => 17),
    store: vi.fn(
      async (_load: number, _page: unknown): Promise<ChannelRefreshResult> => ({
        kind: "applied",
      }),
    ),
    cancel: vi.fn(async (_load: number) => {}),
  };
  return { api, writer };
}
function gate<T>() {
  let resolve!: (value: T) => void;
  const pending = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { pending, resolve };
}

test("waits for the native revision before HTTP and snapshots the requested channel", async () => {
  const token = gate<number>(),
    sent = vi.fn<typeof fetch>(async () => response());
  const { api, writer } = setup(sent);
  writer.begin.mockImplementation(() => token.pending);
  writer.store.mockResolvedValueOnce({ kind: "superseded" });
  const query = { ...request, channelId };
  const operation = refreshChannelHistory(api, writer, query);
  query.channelId = "z".repeat(26);
  expect(sent).not.toHaveBeenCalled();
  token.resolve(53);
  await expect(operation).resolves.toEqual({ kind: "superseded" });
  expect(writer.begin).toHaveBeenCalledWith(channelId);
  expect(writer.store).toHaveBeenCalledWith(
    53,
    expect.objectContaining({
      channelId,
      source: { kind: "latest" },
      order: [id],
    }),
  );
  expect(writer.cancel).not.toHaveBeenCalled();
});

test("a cancelled outstanding ticket is released even when native begin completes late", async () => {
  const token = gate<number>(),
    sent = vi.fn<typeof fetch>(async () => response());
  const { api, writer } = setup(sent);
  writer.begin.mockImplementation(() => token.pending);
  const controller = new AbortController();
  const operation = refreshChannelHistory(
    api,
    writer,
    request,
    controller.signal,
  );
  const reason = Error("left this channel");
  controller.abort(reason);
  token.resolve(19);
  await expect(operation).rejects.toBe(reason);
  expect(writer.cancel).toHaveBeenCalledWith(19);
  expect(sent).not.toHaveBeenCalled();
});

test("failed focus cancels the two sibling HTTP reads and stores no part of the page", async () => {
  const started = gate<void>(),
    failThread = gate<Response>(),
    signals: AbortSignal[] = [];
  const { api, writer } = setup(async (input, init) => {
    const req = new Request(input, init);
    signals.push(req.signal);
    if (signals.length === 3) started.resolve();
    if (new URL(req.url).pathname.endsWith("/thread")) {
      expect(new URL(req.url).searchParams.get("perPage")).toBe("60");
      return failThread.pending;
    }
    return new Promise<Response>((_, reject) =>
      req.signal.addEventListener("abort", () => reject(req.signal.reason), {
        once: true,
      }),
    );
  });
  const operation = refreshChannelHistory(api, writer, {
    ...request,
    kind: "focused",
    postId: id,
  });
  await started.pending;
  failThread.resolve(Response.json({ message: "removed" }, { status: 404 }));
  await expect(operation).rejects.toMatchObject({ response: { status: 404 } });
  expect(signals).toHaveLength(3);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(writer.cancel).toHaveBeenCalledOnce();
  expect(writer.store).not.toHaveBeenCalled();
});

test("invalid input stops before reserving and malformed responses release the ticket", async () => {
  const { api, writer } = setup(async () =>
    Response.json({ order: [id], posts: {} }),
  );
  await expect(
    refreshChannelHistory(api, writer, { ...request, perPage: 201 }),
  ).rejects.toThrow(RangeError);
  await expect(
    refreshChannelHistory(api, writer, {
      ...request,
      kind: "after",
      postId: "bad",
    }),
  ).rejects.toThrow(TypeError);
  await expect(
    refreshChannelHistory(api, writer, { ...request, kind: "since", since: 0 }),
  ).rejects.toThrow(RangeError);
  expect(writer.begin).not.toHaveBeenCalled();
  await expect(refreshChannelHistory(api, writer, request)).rejects.toThrow(
    TypeError,
  );
  expect(writer.cancel).toHaveBeenCalledOnce();
  expect(writer.store).not.toHaveBeenCalled();
});

test("the submitted transaction returns its own result after HTTP cancellation", async () => {
  const entered = gate<void>(),
    committed = gate<ChannelRefreshResult>();
  const { api, writer } = setup(async () => response());
  writer.store.mockImplementationOnce(() => {
    entered.resolve();
    return committed.pending;
  });
  const controller = new AbortController();
  const operation = refreshChannelHistory(
    api,
    writer,
    request,
    controller.signal,
  );
  await entered.pending;
  controller.abort("after submission");
  committed.resolve({ kind: "applied" });
  await expect(operation).resolves.toEqual({ kind: "applied" });
  expect(writer.cancel).not.toHaveBeenCalled();
});
