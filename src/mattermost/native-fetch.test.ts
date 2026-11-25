// @vitest-environment node
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, test, vi } from "vitest";
import {
  Configuration,
  FetchError,
  SystemApi,
} from "../../vendor/mattermost/index.js";
import { nativeFetch } from "./native-fetch.ts";
import {
  openAccountRestConnection,
  openNativeRestConnection,
} from "./native-rest.ts";

const ipc = vi.hoisted(() =>
  vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>(),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc }));
afterEach(() => {
  ipc.mockReset();
  vi.restoreAllMocks();
});

const url = "https://fixture.example.test/team/api/v4/system/ping";
const head = { status: 200, headers: [["X-Test", "one"]], hasBody: true };
const ids = { connection: 41, exchange: 29 };
const chunk = () => new TextEncoder().encode("hello").buffer;
function setup(overrides: Record<string, () => unknown> = {}) {
  const handlers: Record<string, () => unknown> = {
    open_rest_connection: () => ids.connection,
    prepare_rest_request: () => ids.exchange,
    send_rest_request: () => head,
    read_rest_body: () => new ArrayBuffer(0),
    cancel_rest_request: () => undefined,
    ...overrides,
  };
  ipc.mockImplementation(async (command) => handlers[command]());
}
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
function readerOf(response: Response) {
  assert(response.body);
  return response.body.getReader();
}
function calls(command: string) {
  return ipc.mock.calls.filter(([name]) => name === command);
}

test("an already aborted request and a non-JSON body are rejected before allocation", async () => {
  const reason = new Error("caller stopped");
  await expect(
    nativeFetch(41, url, { signal: AbortSignal.abort(reason) }),
  ).rejects.toBe(reason);
  await expect(
    nativeFetch(41, url, { method: "POST", body: "x" }),
  ).rejects.toMatchObject({ cause: "operation_denied" });
  expect(ipc).not.toHaveBeenCalled();
});

const batchUrl = "https://fixture.example.test/team/api/v4/users/ids";
function postBody(body: BodyInit, signal?: AbortSignal) {
  return {
    method: "POST",
    body,
    signal,
    duplex: "half" as const,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  };
}

test("keeps the exact UTF-8 text and an explicitly empty body in one send", async () => {
  setup({
    send_rest_request: () => ({ status: 204, headers: [], hasBody: false }),
  });
  const text = '\ufeff  ["Привет 👋"]\n';
  const bytes = new TextEncoder().encode(text);
  const chunks = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  await nativeFetch(41, new Request(batchUrl, postBody(chunks)));
  await nativeFetch(41, batchUrl, postBody(""));
  const sent = calls("send_rest_request").map(([, args]) => args);
  expect(sent.map((args) => args.body)).toEqual([text, ""]);
  expect(sent[0]).toEqual({
    ...ids,
    method: "POST",
    url: batchUrl,
    headers: [["content-type", "application/json; charset=utf-8"]],
    body: text,
  });
  expect(calls("prepare_rest_request")).toHaveLength(2);
});

test("malformed UTF-8 and failed streams expose no payload or exchange", async () => {
  const broken = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("private payload"));
    },
  });
  for (const body of [Uint8Array.of(0xff), Uint8Array.of(0xe2, 0x82), broken]) {
    const error: unknown = await nativeFetch(
      41,
      batchUrl,
      postBody(body),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({ message: "Invalid REST request body" });
    expect(error).not.toHaveProperty("cause");
  }
  expect(ipc).not.toHaveBeenCalled();
});

test.each([false, true])(
  "abort stops the input without waiting for source cleanup, partial %s",
  async (partial) => {
    const abort = new AbortController();
    const stalled = gate<void>();
    const cleanup = gate<void>();
    const cancel = vi.fn(() => cleanup.promise);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (partial) controller.enqueue(Uint8Array.of(0x5b));
      },
      pull() {
        stalled.resolve();
      },
      cancel,
    });
    const result = nativeFetch(41, batchUrl, postBody(body, abort.signal));
    await stalled.promise;
    const reason = new Error("user stopped");
    abort.abort(reason);
    try {
      await expect(result).rejects.toBe(reason);
      expect(cancel).toHaveBeenCalledExactlyOnceWith(reason);
      expect(ipc).not.toHaveBeenCalled();
      expect(body.locked).toBe(false);
    } finally {
      cleanup.resolve();
    }
  },
);

test("abort during prepare releases the handle and never sends", async () => {
  const prepare = gate<number>();
  setup({ prepare_rest_request: () => prepare.promise });
  const controller = new AbortController();
  const reason = { cancelledBy: "caller" };
  const result = nativeFetch(41, url, { signal: controller.signal });
  controller.abort(reason);
  prepare.resolve(29);
  await expect(result).rejects.toBe(reason);
  expect(ipc.mock.calls).toEqual([
    ["prepare_rest_request", { connection: 41 }],
    ["cancel_rest_request", ids],
  ]);
});

test("a Request uses its effective headers and body demand controls IPC", async () => {
  const chunks = [chunk(), new ArrayBuffer(0)];
  setup({ read_rest_body: () => chunks.shift() });
  const added = vi.spyOn(AbortSignal.prototype, "addEventListener");
  const removed = vi.spyOn(AbortSignal.prototype, "removeEventListener");
  const source = new AbortController();
  const response = await nativeFetch(
    41,
    new Request(url, { headers: { "X-Input": "one" }, signal: source.signal }),
    { headers: { "X-Input": "two" } },
  );
  const callback = added.mock.lastCall?.[1];
  const signal = added.mock.contexts.at(-1);
  expect(callback).toBeTypeOf("function");
  expect(calls("send_rest_request")[0][1]).toEqual({
    ...ids,
    url,
    method: "GET",
    headers: [["x-input", "two"]],
  });
  expect(response.headers.get("x-test")).toBe("one");
  await delay(0);
  expect(calls("read_rest_body")).toHaveLength(0);
  const reader = readerOf(response);
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("hello");
  expect(calls("read_rest_body")).toHaveLength(1);
  expect(await reader.read()).toEqual({ value: undefined, done: true });
  expect(calls("read_rest_body")).toHaveLength(2);
  const index = removed.mock.calls.findIndex(
    ([name, fn]) => name === "abort" && fn === callback,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  expect(removed.mock.contexts[index]).toBe(signal);
  source.abort();
  expect(calls("cancel_rest_request")).toHaveLength(0);
});

test("clones share a single native response", async () => {
  const chunks = [chunk(), new ArrayBuffer(0)];
  setup({ read_rest_body: () => chunks.shift() });
  const response = await nativeFetch(41, url);
  const copy = response.clone();
  expect(await Promise.all([response.text(), copy.text()])).toEqual([
    "hello",
    "hello",
  ]);
  expect(calls("send_rest_request")).toHaveLength(1);
  expect(calls("read_rest_body")).toHaveLength(2);
});

test.each([204, 205, 304])(
  "status %i has no body and releases the abort listener",
  async (status) => {
    setup({ send_rest_request: () => ({ ...head, status, hasBody: false }) });
    const controller = new AbortController();
    const response = await nativeFetch(41, url, { signal: controller.signal });
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    controller.abort();
    expect(calls("read_rest_body")).toHaveLength(0);
    expect(calls("cancel_rest_request")).toHaveLength(0);
  },
);

test.each([false, true])(
  "signal abort errors the body with its original reason, pending read %s",
  async (read) => {
    const part = gate<ArrayBuffer>();
    const started = gate<void>();
    setup({
      read_rest_body: () => {
        started.resolve();
        return part.promise;
      },
    });
    const controller = new AbortController();
    const response = await nativeFetch(41, url, { signal: controller.signal });
    const reader = readerOf(response);
    const pending = read ? reader.read() : undefined;
    if (read) await started.promise;
    const reason = new DOMException("Stopped", "AbortError");
    controller.abort(reason);
    await expect(pending ?? reader.read()).rejects.toBe(reason);
    part.resolve(chunk());
    await delay(0);
    expect(calls("cancel_rest_request")).toHaveLength(1);
  },
);

test("reader cancellation waits for native cleanup and detaches its exact listener", async () => {
  const cancelled = gate<void>();
  const added = vi.spyOn(AbortSignal.prototype, "addEventListener");
  const removed = vi.spyOn(AbortSignal.prototype, "removeEventListener");
  setup({ cancel_rest_request: () => cancelled.promise });
  const controller = new AbortController();
  const response = await nativeFetch(41, url, { signal: controller.signal });
  const signal = added.mock.contexts.at(-1);
  const callback = added.mock.lastCall?.[1];
  expect(callback).toBeTypeOf("function");
  let done = false;
  const pending = readerOf(response)
    .cancel()
    .then(() => {
      done = true;
    });
  await delay(0);
  expect(done).toBe(false);
  const index = removed.mock.calls.findIndex(
    ([name, fn]) => name === "abort" && fn === callback,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  expect(removed.mock.contexts[index]).toBe(signal);
  controller.abort();
  cancelled.resolve();
  await pending;
  expect(calls("cancel_rest_request")).toHaveLength(1);
});

test("a native failure reaches the generator as a transport error", async () => {
  setup({ send_rest_request: () => Promise.reject("network") });
  const connection = await openNativeRestConnection(
    "https://fixture.example.test/team/",
  );
  const api = new SystemApi(new Configuration(connection));
  const error: unknown = await api
    .getPing({ useRestSemantics: true })
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(FetchError);
  expect(error).toMatchObject({
    cause: { name: "TypeError", cause: "network" },
  });
  expect(calls("cancel_rest_request")).toHaveLength(0);
});

test("unexpected IPC messages are sanitized and invalid responses release native ownership", async () => {
  setup({ send_rest_request: () => Promise.reject("secret query or header") });
  await expect(nativeFetch(41, url)).rejects.toMatchObject({
    message: "Native REST request failed",
    cause: "ipc",
  });
  expect(calls("cancel_rest_request")).toHaveLength(1);
  setup({ send_rest_request: () => ({ ...head, status: 101 }) });
  await expect(nativeFetch(41, url)).rejects.toMatchObject({ cause: "ipc" });
  expect(calls("cancel_rest_request")).toHaveLength(2);
  setup({ read_rest_body: () => [65, 66] });
  const response = await nativeFetch(41, url);
  await expect(response.text()).rejects.toMatchObject({ cause: "ipc" });
  expect(calls("cancel_rest_request")).toHaveLength(3);
});

test("a late head cannot revive an aborted request", async () => {
  const headReady = gate<typeof head>();
  const sending = gate<void>();
  setup({
    send_rest_request: () => {
      sending.resolve();
      return headReady.promise;
    },
    cancel_rest_request: () => Promise.reject("unknown_exchange"),
  });
  const controller = new AbortController();
  const pending = nativeFetch(41, url, { signal: controller.signal });
  await sending.promise;
  controller.abort("user cancelled");
  headReady.resolve(head);
  await expect(pending).rejects.toBe("user cancelled");
  expect(calls("cancel_rest_request")).toHaveLength(1);
  expect(calls("read_rest_body")).toHaveLength(0);
});

test.each(["unknown_connection", "cancelled", "network"])(
  "a native body read failure carries its code %s",
  async (code) => {
    setup({ read_rest_body: () => Promise.reject(code) });
    const controller = new AbortController();
    const response = await nativeFetch(41, url, { signal: controller.signal });
    await expect(response.text()).rejects.toMatchObject({
      name: "TypeError",
      cause: code,
    });
    controller.abort();
    expect(calls("cancel_rest_request")).toHaveLength(0);
  },
);

test("search posts normal JSON on the native account resource and closing the account discards its pending response", async () => {
  const body = JSON.stringify({
    order: [],
    posts: {},
    matches: null,
    first_inaccessible_post_time: 0,
    prev_post_id: "",
    next_post_id: "",
  });
  const bytes = new TextEncoder().encode(body).buffer;
  const started = gate<void>(),
    reply = gate<ArrayBuffer>();
  let read = 0;
  setup({
    read_rest_body: () => {
      if (read++ > 0) return new ArrayBuffer(0);
      started.resolve();
      return reply.promise;
    },
    close_rest_connection: () => undefined,
  });
  const server = "https://fixture.example.test/team",
    userId = "u".repeat(26);
  const account = await openAccountRestConnection(server, userId);
  const request = {
    teamId: null,
    terms: "in:town-square polar",
    isOrSearch: false,
    includeDeletedChannels: false,
    timeZoneOffsetSeconds: 3600,
    page: 0,
  };
  const pending = account.readPostSearchPage(request);
  await started.promise;
  expect(ipc).toHaveBeenCalledWith("open_rest_connection", {
    basePath: server,
    userId,
  });
  const send = ipc.mock.calls.find(
    ([operation]) => operation === "send_rest_request",
  )?.[1];
  expect(send).toMatchObject({
    ...ids,
    method: "POST",
    url: server + "/api/v4/posts/search",
  });
  expect(JSON.parse(String(send?.body))).toEqual({
    terms: request.terms,
    is_or_search: false,
    include_deleted_channels: false,
    time_zone_offset: 3600,
    page: 0,
    per_page: 20,
  });
  expect(new Headers(send?.headers as HeadersInit).has("authorization")).toBe(
    false,
  );
  await account.close();
  reply.resolve(bytes);
  await expect(pending).rejects.toBe("cancelled");
  await expect(account.readFileSearchPage(request)).rejects.toBe(
    "unknown_connection",
  );
  expect(
    ipc.mock.calls.filter(([operation]) => operation === "send_rest_request"),
  ).toHaveLength(1);
});
