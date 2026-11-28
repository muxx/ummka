// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, test, vi } from "vitest";
import {
  accountChannelEvents,
  type ChannelEventNotice,
} from "./account-channel-events.ts";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class<T> {
    constructor(readonly onmessage: (packet: T) => void) {}
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

test("offline cancels application and an earlier generation cannot acknowledge the next notice", async () => {
  const started = deferred<void>(),
    applied = deferred<void>(),
    released = deferred<void>();
  const received = deferred<(packet: unknown) => void>(),
    stopped = deferred<void>();
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "prepare_channel_observer") return "observer";
    if (command === "run_channel_observer") {
      received.resolve(
        (args as { events: { onmessage: (packet: unknown) => void } }).events
          .onmessage,
      );
      return stopped.promise;
    }
    if (command === "close_channel_observer") stopped.resolve();
    if (command === "acknowledge_channel_notice") applied.resolve();
  });
  const owner = new AbortController();
  const attempts: AbortSignal[] = [];
  const apply = async (_notice: ChannelEventNotice, signal: AbortSignal) => {
    attempts.push(signal);
    if (attempts.length === 1) {
      started.resolve();
      await released.promise;
    }
  };
  const observe = accountChannelEvents(7);
  const done = observe(apply, owner.signal);
  const send = await received.promise;
  const packet = {
    kind: "notice",
    receipt: "old",
    generation: 0,
    notice: { kind: "reconcile" },
  };
  send(packet);
  await started.promise;
  online.mockReturnValue(false);
  window.dispatchEvent(new Event("offline"));
  expect(attempts[0].aborted).toBe(true);
  online.mockReturnValue(true);
  window.dispatchEvent(new Event("online"));
  send(packet);
  send({ ...packet, receipt: "new", generation: 2 });
  send({ kind: "cancel", receipt: "old" });
  released.resolve();
  await applied.promise;
  expect(attempts).toHaveLength(2);
  expect(attempts[1].aborted).toBe(false);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "acknowledge_channel_notice"),
  ).toEqual([
    [
      "acknowledge_channel_notice",
      { rid: 7, observer: "observer", receipt: "new" },
    ],
  ]);
  owner.abort();
  await done;
  expect(invoke).toHaveBeenCalledWith("close_channel_observer", {
    rid: 7,
    observer: "observer",
  });
});

test("remount waits for a cancelled native preparation to release its subscription", async () => {
  const prepared = deferred<string>(),
    closed = deferred<void>();
  const visits: string[] = [];
  let opens = 0;
  vi.mocked(invoke).mockImplementation(async (command) => {
    visits.push(command);
    if (command === "prepare_channel_observer")
      return ++opens === 1 ? prepared.promise : "second";
    if (command === "close_channel_observer" && opens === 1)
      return closed.promise;
    if (command === "run_channel_observer")
      throw new Error("signed account retired");
  });
  const first = new AbortController(),
    second = new AbortController();
  const observe = accountChannelEvents(8);
  const a = observe(async () => undefined, first.signal);
  first.abort();
  const b = observe(async () => undefined, second.signal);
  prepared.resolve("first");
  await vi.waitFor(() =>
    expect(visits).toEqual([
      "prepare_channel_observer",
      "close_channel_observer",
    ]),
  );
  closed.resolve();
  await a;
  await expect(b).rejects.toThrow("signed account retired");
  expect(visits).toEqual([
    "prepare_channel_observer",
    "close_channel_observer",
    "prepare_channel_observer",
    "run_channel_observer",
    "close_channel_observer",
  ]);
});
