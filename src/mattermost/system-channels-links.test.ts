import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { routeChannelsLink } from "./route-channels-link";
import {
  type SystemChannelsLink,
  watchSystemChannelsLinks,
} from "./system-channels-links";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./route-channels-link.ts", () => ({ routeChannelsLink: vi.fn() }));

const url = "https://chat.test/Install/team/channels/town-square";
const target = {
  kind: "conversation",
  serverUrl: "https://chat.test/Install",
  team: "team",
  route: "channels",
  identifier: "town-square",
  postId: null,
} as const;
let active: AbortController;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const unlisten = vi.fn();
let wake: () => void;
let queue: { id: string; href: string }[];
const read = vi.mocked(invoke);
const route = vi.mocked(routeChannelsLink);
const errors = vi.fn();
const navigate =
  vi.fn<(link: SystemChannelsLink, signal: AbortSignal) => Promise<void>>();
function head() {
  const delivery = queue[0];
  return delivery ? { ...delivery, waiting: queue.length - 1 } : null;
}
beforeEach(() => {
  vi.resetAllMocks();
  active = new AbortController();
  queue = [];
  vi.mocked(listen).mockImplementation(async (name, callback, options) => {
    expect(name).toBe("channels-link-available");
    expect(options?.target).toEqual({ kind: "Webview", label: "main" });
    wake = () => callback({ event: name, id: 1, payload: undefined as never });
    return unlisten;
  });
  read.mockImplementation(async (name, args) => {
    if (name === "pending_channels_link") return head();
    expect(name).toBe("acknowledge_channels_link");
    expect(args).toEqual({ id: queue[0]?.id });
    queue.shift();
    return true;
  });
  route.mockResolvedValue({ status: "sign_in_required", target });
  navigate.mockResolvedValue(undefined);
});
afterEach(() => active.abort());

function delivered() {
  return navigate.mock.calls.map(([link]) => link.id);
}

test("drains cold and warm links in order with only one active navigation", async () => {
  queue.push({ id: "1", href: url }, { id: "2", href: url });
  const gate = deferred<void>();
  navigate.mockImplementationOnce(() => gate.promise);
  await watchSystemChannelsLinks(navigate, errors, active.signal);
  await vi.waitFor(() => expect(delivered()).toEqual(["1"]));
  queue.push({ id: "3", href: url + "/next" });
  wake();
  wake();
  expect(queue).toHaveLength(3);
  expect(delivered()).toEqual(["1"]);
  gate.resolve();
  await vi.waitFor(() => expect(queue).toHaveLength(0));
  expect(delivered()).toEqual(["1", "2", "3"]);
  expect(navigate.mock.calls[0]).toEqual([
    { id: "1", href: url, route: { status: "sign_in_required", target } },
    active.signal,
  ]);
  expect(errors).not.toHaveBeenCalled();
});

test("a warm notification during an empty native read is retained", async () => {
  const gate = deferred<null>();
  read.mockImplementationOnce(() => gate.promise);
  route.mockResolvedValue(null);
  await watchSystemChannelsLinks(navigate, errors, active.signal);
  queue.push({ id: "new", href: url });
  wake();
  gate.resolve(null);
  await vi.waitFor(() => expect(queue).toHaveLength(0));
  expect(navigate).toHaveBeenCalledWith(
    { id: "new", href: url, route: null },
    active.signal,
  );
});

test("the first subscription and a reopened view read the waiting count without a notification", async () => {
  queue.push({ id: "a", href: url }, { id: "b", href: url });
  const first = deferred<void>();
  const reopened = deferred<void>();
  navigate
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(reopened.promise);
  const onWaiting = vi.fn();
  await watchSystemChannelsLinks(navigate, errors, active.signal, {
    onWaiting,
  });
  await vi.waitFor(() => expect(delivered()).toEqual(["a"]));
  expect(onWaiting.mock.calls).toEqual([["a", 1]]);
  active.abort();
  first.resolve();
  active = new AbortController();
  await watchSystemChannelsLinks(navigate, errors, active.signal, {
    onWaiting,
  });
  await vi.waitFor(() => expect(delivered()).toEqual(["a", "a"]));
  expect(onWaiting.mock.calls).toEqual([
    ["a", 1],
    ["a", 1],
  ]);
  active.abort();
  reopened.resolve();
  expect(queue).toHaveLength(2);
});

test("a notification while reading the first snapshot refreshes its count", async () => {
  queue.push({ id: "a", href: url });
  const before = head();
  const snapshot = deferred<ReturnType<typeof head>>();
  read.mockReturnValueOnce(snapshot.promise);
  const gate = deferred<void>();
  navigate.mockReturnValueOnce(gate.promise);
  const onWaiting = vi.fn();
  await watchSystemChannelsLinks(navigate, errors, active.signal, {
    onWaiting,
  });
  queue.push({ id: "b", href: url }, { id: "c", href: url });
  wake();
  snapshot.resolve(before);
  await vi.waitFor(() => expect(onWaiting.mock.calls).toEqual([["a", 2]]));
  expect(delivered()).toEqual(["a"]);
  expect(queue).toHaveLength(3);
  active.abort();
  gate.resolve();
});

test("a notification during an active refresh requests a newer snapshot without another navigation", async () => {
  queue.push({ id: "a", href: url });
  const gate = deferred<void>();
  navigate.mockReturnValueOnce(gate.promise);
  const onWaiting = vi.fn();
  await watchSystemChannelsLinks(navigate, errors, active.signal, {
    onWaiting,
  });
  await vi.waitFor(() => expect(delivered()).toEqual(["a"]));
  queue.push({ id: "b", href: url });
  const before = head();
  const snapshot = deferred<ReturnType<typeof head>>();
  read.mockReturnValueOnce(snapshot.promise);
  wake();
  expect(read).toHaveBeenCalledTimes(2);
  queue.push({ id: "c", href: url });
  wake();
  expect(read).toHaveBeenCalledTimes(2);
  snapshot.resolve(before);
  await vi.waitFor(() =>
    expect(onWaiting.mock.calls).toEqual([
      ["a", 0],
      ["a", 2],
    ]),
  );
  expect(delivered()).toEqual(["a"]);
  expect(queue).toHaveLength(3);
  active.abort();
  gate.resolve();
});

test("a late refresh for the acknowledged head cannot replace the next head's count", async () => {
  queue.push({ id: "a", href: url });
  const first = deferred<void>();
  const second = deferred<void>();
  navigate
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const onWaiting = vi.fn();
  await watchSystemChannelsLinks(navigate, errors, active.signal, {
    onWaiting,
  });
  await vi.waitFor(() => expect(delivered()).toEqual(["a"]));
  queue.push({ id: "b", href: url });
  const before = head();
  const snapshot = deferred<ReturnType<typeof head>>();
  read.mockReturnValueOnce(snapshot.promise);
  wake();
  first.resolve();
  await vi.waitFor(() => expect(delivered()).toEqual(["a", "b"]));
  queue.push({ id: "c", href: url });
  wake();
  snapshot.resolve(before);
  await vi.waitFor(() =>
    expect(onWaiting.mock.calls).toEqual([
      ["a", 0],
      ["b", 0],
      ["b", 1],
    ]),
  );
  expect(queue.map((x) => x.id)).toEqual(["b", "c"]);
  active.abort();
  second.resolve();
});

test("a failed read of the waiting count keeps the active delivery and clears the count", async () => {
  queue.push({ id: "a", href: url });
  const gate = deferred<void>();
  navigate.mockReturnValueOnce(gate.promise);
  const onWaiting = vi.fn();
  await watchSystemChannelsLinks(navigate, errors, active.signal, {
    onWaiting,
  });
  await vi.waitFor(() => expect(delivered()).toEqual(["a"]));
  queue.push({ id: "b", href: url });
  read.mockRejectedValueOnce(Error("snapshot unavailable"));
  wake();
  await vi.waitFor(() =>
    expect(onWaiting).toHaveBeenLastCalledWith("a", undefined),
  );
  expect(errors).not.toHaveBeenCalled();
  wake();
  await vi.waitFor(() =>
    expect(onWaiting.mock.calls).toEqual([
      ["a", 0],
      ["a", undefined],
      ["a", 1],
    ]),
  );
  expect(delivered()).toEqual(["a"]);
  active.abort();
  gate.resolve();
});

test.each(["routing", "navigation", "acknowledgement"])(
  "a %s failure leaves the link available for explicit retry",
  async (stage) => {
    queue.push({ id: "1", href: url });
    const failure = new Error(stage);
    if (stage === "routing") route.mockRejectedValueOnce(failure);
    if (stage === "navigation") navigate.mockRejectedValueOnce(failure);
    if (stage === "acknowledgement") {
      read.mockResolvedValueOnce(head()).mockRejectedValueOnce(failure);
    }
    const observer = await watchSystemChannelsLinks(
      navigate,
      errors,
      active.signal,
    );
    await vi.waitFor(() => expect(errors).toHaveBeenCalledWith(failure, "1"));
    const calls = read.mock.calls.length;
    wake();
    expect(read).toHaveBeenCalledTimes(calls);
    expect(queue).toHaveLength(1);
    observer.retry();
    await vi.waitFor(() => expect(queue).toHaveLength(0));
    expect(unlisten).not.toHaveBeenCalled();
  },
);

test("a refused acknowledgement pauses delivery until the caller retries", async () => {
  queue.push({ id: "1", href: url });
  read.mockResolvedValueOnce(head()).mockResolvedValueOnce(false);
  const observer = await watchSystemChannelsLinks(
    navigate,
    errors,
    active.signal,
  );
  await vi.waitFor(() =>
    expect(errors).toHaveBeenCalledWith(
      new Error("System link was not acknowledged"),
      "1",
    ),
  );
  wake();
  expect(delivered()).toEqual(["1"]);
  expect(read).toHaveBeenCalledTimes(2);
  observer.retry();
  await vi.waitFor(() => expect(queue).toHaveLength(0));
  expect(delivered()).toEqual(["1"]);
});

test("disposal during account resolution leaves the destination for the next view", async () => {
  queue.push({ id: "1", href: url });
  const gate = deferred<null>();
  route.mockReturnValueOnce(gate.promise);
  await watchSystemChannelsLinks(navigate, errors, active.signal);
  await vi.waitFor(() => expect(route).toHaveBeenCalledWith(url));
  active.abort();
  gate.resolve(null);
  await gate.promise;
  expect(unlisten).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
  expect(queue).toHaveLength(1);
});

test("aborting while subscribing releases the eventual listener without reading", async () => {
  const gate = deferred<() => void>();
  vi.mocked(listen).mockImplementationOnce(() => gate.promise);
  const started = watchSystemChannelsLinks(navigate, errors, active.signal);
  active.abort();
  gate.resolve(unlisten);
  await expect(started).rejects.toMatchObject({ name: "AbortError" });
  expect(unlisten).toHaveBeenCalledTimes(1);
  expect(read).not.toHaveBeenCalled();
});

test("skipping a failed route acknowledges only the observed head", async () => {
  queue.push({ id: "1", href: url }, { id: "2", href: url });
  route.mockRejectedValueOnce(Error("registry"));
  const observer = await watchSystemChannelsLinks(
    navigate,
    errors,
    active.signal,
  );
  await vi.waitFor(() => expect(errors).toHaveBeenCalledOnce());
  observer.dismiss("2");
  expect(delivered()).toEqual([]);
  expect(queue).toHaveLength(2);
  observer.dismiss("1");
  await vi.waitFor(() => expect(queue).toHaveLength(0));
  expect(delivered()).toEqual(["2"]);
});
test("a failed read before any ID was observed cannot be dismissed", async () => {
  queue.push({ id: "1", href: url });
  read.mockRejectedValueOnce(Error("storage"));
  const observer = await watchSystemChannelsLinks(
    navigate,
    errors,
    active.signal,
  );
  await vi.waitFor(() =>
    expect(errors).toHaveBeenCalledWith(expect.any(Error), undefined),
  );
  observer.dismiss("1");
  expect(queue).toHaveLength(1);
  observer.retry();
  await vi.waitFor(() => expect(queue).toHaveLength(0));
  expect(delivered()).toEqual(["1"]);
});
test("a lost acknowledgement response does not suppress the new delivery with the same URL", async () => {
  queue.push({ id: "1", href: url }, { id: "2", href: url });
  read.mockResolvedValueOnce(head()).mockImplementationOnce(async () => {
    queue.shift();
    throw Error("response lost");
  });
  const observer = await watchSystemChannelsLinks(
    navigate,
    errors,
    active.signal,
  );
  await vi.waitFor(() => expect(errors).toHaveBeenCalledOnce());
  observer.retry();
  await vi.waitFor(() => expect(queue).toHaveLength(0));
  expect(delivered()).toEqual(["1", "2"]);
});
