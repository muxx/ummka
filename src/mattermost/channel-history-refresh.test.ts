import { expect, test, vi } from "vitest";
import { Configuration, PostsApi } from "../../vendor/mattermost/index.js";
import {
  type ChannelRefreshResult,
  refreshChannelHistory,
} from "./channel-history-refresh.ts";

const channelId = "c".repeat(26),
  id = "p".repeat(26);
const request = { kind: "latest", channelId, collapsedThreads: false } as const;
function wire(postId: string, props?: object) {
  return {
    id: postId,
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
    props,
  };
}
function response(props?: object) {
  return Response.json({
    order: [id],
    posts: { [id]: wire(id, props) },
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
  const observe = vi.fn();
  const operation = refreshChannelHistory(
    api,
    writer,
    query,
    undefined,
    observe,
  );
  query.channelId = "z".repeat(26);
  expect(sent).not.toHaveBeenCalled();
  token.resolve(53);
  await expect(operation).resolves.toEqual({ kind: "superseded" });
  expect(observe).not.toHaveBeenCalled();
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

test("a webhook page received after cancellation never reaches storage", async () => {
  const started = gate<void>(),
    delayed = gate<Response>();
  const { api, writer } = setup(async () => {
    started.resolve();
    return delayed.pending;
  });
  const controller = new AbortController();
  const operation = refreshChannelHistory(
    api,
    writer,
    request,
    controller.signal,
  );
  await started.pending;
  const reason = Error("changed channel");
  controller.abort(reason);
  delayed.resolve(response({ from_webhook: "true" }));
  await expect(operation).rejects.toBe(reason);
  expect(writer.cancel).toHaveBeenCalledWith(17);
  expect(writer.store).not.toHaveBeenCalled();
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

test("focus combines versioned observations before submitting a single history window", async () => {
  const reply = "r".repeat(26);
  const malformed = "m".repeat(26);
  const confirmed = "w".repeat(26);
  const removed = "d".repeat(26);
  const webhook = { from_webhook: "true" };
  const invalid = { from_webhook: "unexpected" };
  const ai = {
    ai_generated_by: "u".repeat(26),
    ai_generated_by_username: "fixture",
  };
  const { api, writer } = setup(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/thread")) {
      return Response.json({
        order: [id, reply],
        posts: {
          [id]: {
            ...wire(id, { ...webhook, ...ai }),
            update_at: 30,
            message: "latest root",
            metadata: { priority: { priority: "important" } },
          },
          [reply]: { ...wire(reply, webhook), root_id: id, update_at: 20 },
          [confirmed]: wire(confirmed, webhook),
          [malformed]: wire(malformed, webhook),
          [removed]: { ...wire(removed, webhook), update_at: 30 },
        },
      });
    }
    if (url.searchParams.has("after")) {
      return Response.json({
        order: [reply],
        posts: {
          [reply]: { ...wire(reply), root_id: id, update_at: 12 },
          [confirmed]: wire(confirmed, invalid),
        },
      });
    }
    return Response.json({
      order: [removed],
      posts: {
        [id]: {
          ...wire(id, { ai_generated_by_username: "incomplete" }),
          update_at: 30,
          message: "latest root",
        },
        [reply]: { ...wire(reply), root_id: id, update_at: 17 },
        [confirmed]: wire(confirmed),
        [malformed]: { ...wire(malformed, invalid), update_at: 11 },
        [removed]: { ...wire(removed), delete_at: 15, update_at: 15 },
      },
    });
  });
  await expect(
    refreshChannelHistory(api, writer, {
      ...request,
      kind: "focused",
      postId: id,
    }),
  ).resolves.toEqual({ kind: "applied" });
  expect(writer.store).toHaveBeenCalledExactlyOnceWith(
    17,
    expect.objectContaining({
      order: [reply, id, removed],
      changes: [
        expect.objectContaining({
          kind: "save",
          id: reply,
          updateAt: 20,
          fromWebhook: true,
        }),
        expect.objectContaining({
          kind: "save",
          id: confirmed,
          updateAt: 10,
          fromWebhook: true,
        }),
        expect.objectContaining({
          kind: "save",
          id,
          updateAt: 30,
          message: "latest root",
          fromWebhook: true,
          displayPriority: "important",
          aiAttribution: {
            kind: "source",
            userId: ai.ai_generated_by,
            hasUsername: true,
          },
        }),
        expect.objectContaining({
          kind: "save",
          id: malformed,
          updateAt: 11,
          fromWebhook: true,
        }),
        { kind: "remove", id: removed, channelId },
      ],
    }),
  );
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
  const removed = "r".repeat(26);
  const { api, writer } = setup(async () =>
    Response.json({
      order: [id],
      posts: { [id]: wire(id), [removed]: { ...wire(removed), delete_at: 20 } },
    }),
  );
  writer.store.mockImplementationOnce(() => {
    entered.resolve();
    return committed.pending;
  });
  const controller = new AbortController();
  const observe = vi.fn();
  const operation = refreshChannelHistory(
    api,
    writer,
    request,
    controller.signal,
    observe,
  );
  await entered.pending;
  expect(observe).not.toHaveBeenCalled();
  controller.abort("after submission");
  committed.resolve({ kind: "applied" });
  await expect(operation).resolves.toEqual({ kind: "applied" });
  expect(writer.cancel).not.toHaveBeenCalled();
  expect(observe).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ kind: "save", id, channelId }),
    { kind: "remove", id: removed, channelId },
  ]);
});

test("keeps a confirmed history cutoff even when an empty recent page leaves SQLite unchanged", async () => {
  const { api, writer } = setup(async () =>
    Response.json({ order: [], posts: {}, first_inaccessible_post_time: 20 }),
  );
  await expect(refreshChannelHistory(api, writer, request)).resolves.toEqual({
    kind: "applied",
    firstInaccessiblePostTime: 20,
  });
  expect(writer.store).toHaveBeenCalledWith(
    17,
    expect.objectContaining({ order: [], firstInaccessiblePostTime: 20 }),
  );
});
