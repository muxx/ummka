// @vitest-environment node
import { expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { openPostCollection } from "./post-collection.ts";

const channelId = "c".repeat(26);
const first = { id: "a".repeat(26), channelId, message: "Older" };
const last = { id: "z".repeat(26), channelId, message: "Newer" };
const page = { items: [first, last], firstInaccessiblePostTime: 42 };
const empty = { items: [], firstInaccessiblePostTime: 0 };

function deferredPage() {
  let resolve!: (value: typeof page) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<typeof page>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

function mockAccount() {
  type Account = Parameters<typeof openPostCollection>[0];
  return {
    readPinnedChannelPosts: vi.fn<Account["readPinnedChannelPosts"]>(),
    readSavedPosts: vi.fn<Account["readSavedPosts"]>(),
  };
}

test("first read is shared with subscribers and repeated refreshes replace the entire result", async () => {
  const account = mockAccount();
  const gate = deferredPage();
  account.readPinnedChannelPosts
    .mockReturnValueOnce(gate.promise)
    .mockResolvedValueOnce(empty);
  const view = openPostCollection(account, { kind: "pins", channelId });
  expect(view.getSnapshot()).toEqual({ status: "idle", value: null });
  let reentrant: Promise<void> | undefined;
  const unsubscribe = view.subscribe(() => {
    if (view.getSnapshot().status === "loading") reentrant = view.refresh();
  });
  const pending = view.refresh();
  expect(reentrant).toBe(pending);
  expect(view.refresh()).toBe(pending);
  expect(view.getSnapshot()).toEqual({ status: "loading", value: null });
  await Promise.resolve();
  expect(account.readPinnedChannelPosts).toHaveBeenCalledExactlyOnceWith(
    channelId,
    expect.any(AbortSignal),
  );
  gate.resolve(page);
  await pending;
  expect(view.getSnapshot()).toEqual({ status: "ready", value: page });
  const updated = view.refresh();
  expect(view.getSnapshot()).toEqual({ status: "refreshing", value: page });
  await updated;
  expect(view.getSnapshot()).toEqual({ status: "ready", value: empty });
  expect(account.readSavedPosts).not.toHaveBeenCalled();
  unsubscribe();
  view.close();
});

test("saved reads capture scope, keep server order and request just the first page", async () => {
  const account = mockAccount();
  const scope = { kind: "team" as const, teamId: "t".repeat(26) };
  const original = { ...scope };
  const view = openPostCollection(account, scope);
  scope.teamId = "s".repeat(26);
  account.readSavedPosts.mockResolvedValue({ ...page, items: [last, first] });
  await view.refresh();
  expect(account.readSavedPosts).toHaveBeenCalledExactlyOnceWith(
    original,
    0,
    expect.any(AbortSignal),
  );
  expect(view.getSnapshot().value?.items.map((row) => row.id)).toEqual([
    last.id,
    first.id,
  ]);
  expect(account.readPinnedChannelPosts).not.toHaveBeenCalled();
  view.close();
});

test.each([
  [new Error("offline"), "network", true],
  [
    new ResponseError(new Response(null, { status: 401 })),
    "unauthorized",
    false,
  ],
  [new ResponseError(new Response(null, { status: 403 })), "forbidden", false],
  [new ResponseError(new Response(null, { status: 404 })), "forbidden", false],
  ["session_unavailable", "session", false],
] as const)(
  "refresh handles %s at the current scope",
  async (error, status, retain) => {
    const account = mockAccount();
    account.readSavedPosts
      .mockResolvedValueOnce(page)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(empty);
    const view = openPostCollection(account, { kind: "all" });
    await view.refresh();
    await view.refresh();
    expect(view.getSnapshot()).toEqual({ status, value: retain ? page : null });
    expect(account.readSavedPosts).toHaveBeenCalledTimes(2);
    await view.refresh();
    expect(view.getSnapshot()).toEqual({ status: "ready", value: empty });
    view.close();
  },
);

test.each(["success", "failure"])(
  "closing suppresses late %s and clears the old account",
  async (result) => {
    const account = mockAccount();
    const gate = deferredPage();
    account.readSavedPosts
      .mockResolvedValueOnce(page)
      .mockReturnValueOnce(gate.promise);
    const view = openPostCollection(account, { kind: "channel", channelId });
    await view.refresh();
    const listener = vi.fn();
    view.subscribe(listener);
    const inFlight = view.refresh();
    await Promise.resolve();
    const signal = account.readSavedPosts.mock.calls[1][2];
    expect(signal?.aborted).toBe(false);
    view.close();
    view.close();
    expect(signal?.aborted).toBe(true);
    if (result === "success") gate.resolve(page);
    else gate.reject(new Error("late"));
    await inFlight;
    await view.refresh();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(view.getSnapshot()).toEqual({ status: "closed", value: null });
    expect(account.readSavedPosts).toHaveBeenCalledTimes(2);
  },
);

test("closing from the loading notification prevents the network call", async () => {
  const account = mockAccount();
  const view = openPostCollection(account, { kind: "pins", channelId });
  view.subscribe(() => {
    if (view.getSnapshot().status === "loading") view.close();
  });
  await view.refresh();
  expect(account.readPinnedChannelPosts).not.toHaveBeenCalled();
  expect(view.getSnapshot()).toEqual({ status: "closed", value: null });
});
