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
    setPostSaved: vi.fn<Account["setPostSaved"]>(),
    setPostPinned: vi.fn<Account["setPostPinned"]>(),
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
  expect(view.getSnapshot()).toEqual({
    removing: [],
    status: "idle",
    value: null,
  });
  let reentrant: Promise<void> | undefined;
  const unsubscribe = view.subscribe(() => {
    if (view.getSnapshot().status === "loading") reentrant = view.refresh();
  });
  const pending = view.refresh();
  expect(reentrant).toBe(pending);
  expect(view.refresh()).toBe(pending);
  expect(view.getSnapshot()).toEqual({
    removing: [],
    status: "loading",
    value: null,
  });
  await Promise.resolve();
  expect(account.readPinnedChannelPosts).toHaveBeenCalledExactlyOnceWith(
    channelId,
    expect.any(AbortSignal),
  );
  gate.resolve(page);
  await pending;
  expect(view.getSnapshot()).toEqual({
    removing: [],
    status: "ready",
    value: page,
  });
  const updated = view.refresh();
  expect(view.getSnapshot()).toEqual({
    removing: [],
    status: "refreshing",
    value: page,
  });
  await updated;
  expect(view.getSnapshot()).toEqual({
    removing: [],
    status: "ready",
    value: empty,
  });
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
    expect(view.getSnapshot()).toEqual({
      removing: [],
      status,
      value: retain ? page : null,
    });
    expect(account.readSavedPosts).toHaveBeenCalledTimes(2);
    await view.refresh();
    expect(view.getSnapshot()).toEqual({
      removing: [],
      status: "ready",
      value: empty,
    });
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
    expect(view.getSnapshot()).toEqual({
      removing: [],
      status: "closed",
      value: null,
    });
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
  expect(view.getSnapshot()).toEqual({
    removing: [],
    status: "closed",
    value: null,
  });
});

function heldWrite() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

test.each(["all", "pins"] as const)(
  "%s removes only confirmed rows, sharing same-row writes and allowing distinct rows independently",
  async (kind) => {
    const account = mockAccount();
    account.readPinnedChannelPosts.mockResolvedValue(page);
    account.readSavedPosts.mockResolvedValue(page);
    const action =
      kind === "pins" ? account.setPostPinned : account.setPostSaved;
    const other =
      kind === "pins" ? account.setPostSaved : account.setPostPinned;
    const older = heldWrite();
    const newer = heldWrite();
    action
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const view = openPostCollection(
      account,
      kind === "pins" ? { kind, channelId } : { kind },
    );
    await expect(view.remove(first.id)).resolves.toBe("unavailable");
    await view.refresh();
    expect(await view.remove("missing")).toBe("unavailable");
    let duplicate: Promise<unknown> | undefined;
    view.subscribe(() => {
      if (view.getSnapshot().removing.includes(first.id))
        duplicate = view.remove(first.id);
    });
    const removeFirst = view.remove(first.id);
    const removeLast = view.remove(last.id);
    expect(duplicate).toBe(removeFirst);
    expect(view.getSnapshot()).toEqual({
      status: "ready",
      value: page,
      removing: [first.id, last.id],
    });
    await Promise.resolve();
    expect(action.mock.calls).toEqual([
      [first.id, false, expect.any(AbortSignal)],
      [last.id, false, expect.any(AbortSignal)],
    ]);
    expect(other).not.toHaveBeenCalled();
    newer.resolve();
    expect(await removeLast).toBe("removed");
    expect(view.getSnapshot().value?.items).toEqual([first]);
    expect(view.getSnapshot().removing).toEqual([first.id]);
    older.resolve();
    expect(await removeFirst).toBe("removed");
    expect(view.getSnapshot()).toEqual({
      status: "ready",
      value: { ...page, items: [] },
      removing: [],
    });
    expect(await view.remove(first.id)).toBe("unavailable");
    view.close();
  },
);

test("a read started before confirmation cannot restore a removed pin; a new read can show it pinned again", async () => {
  const account = mockAccount();
  const old = deferredPage();
  account.readPinnedChannelPosts
    .mockResolvedValueOnce(page)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(page);
  const view = openPostCollection(account, { kind: "pins", channelId });
  await view.refresh();
  const read = view.refresh();
  expect(await view.remove(first.id)).toBe("removed");
  old.resolve({ ...page, firstInaccessiblePostTime: 83 });
  await read;
  expect(view.getSnapshot().value).toEqual({
    items: [last],
    firstInaccessiblePostTime: 83,
  });
  await view.refresh();
  expect(view.getSnapshot().value).toEqual(page);
  view.close();
});

test.each([
  [new Error("offline"), "network"],
  [new ResponseError(new Response(null, { status: 403 })), "refused"],
  [new ResponseError(new Response(null, { status: 500 })), "refused"],
] as const)(
  "a failed write keeps the current entries for an explicit retry",
  async (error, outcome) => {
    const account = mockAccount();
    account.readSavedPosts.mockResolvedValue(page);
    account.setPostSaved.mockRejectedValueOnce(error).mockResolvedValueOnce();
    const view = openPostCollection(account, { kind: "all" });
    await view.refresh();
    expect(await view.remove(first.id)).toBe(outcome);
    expect(view.getSnapshot()).toEqual({
      status: "ready",
      value: page,
      removing: [],
    });
    expect(account.setPostSaved).toHaveBeenCalledOnce();
    expect(await view.remove(first.id)).toBe("removed");
    expect(view.getSnapshot().value?.items).toEqual([last]);
    view.close();
  },
);

test("loss of the session while writing cancels other writes and the old read", async () => {
  const account = mockAccount();
  const readGate = deferredPage();
  const writing = heldWrite();
  account.readSavedPosts
    .mockResolvedValueOnce(page)
    .mockReturnValueOnce(readGate.promise)
    .mockResolvedValueOnce(empty);
  account.setPostSaved
    .mockReturnValueOnce(writing.promise)
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 401 })),
    );
  const view = openPostCollection(account, { kind: "channel", channelId });
  await view.refresh();
  const read = view.refresh();
  const firstWrite = view.remove(first.id);
  expect(await view.remove(last.id)).toBe("unauthorized");
  expect(account.setPostSaved.mock.calls[0][2]?.aborted).toBe(true);
  expect(account.readSavedPosts.mock.calls[1][2]?.aborted).toBe(true);
  expect(view.getSnapshot()).toEqual({
    status: "unauthorized",
    value: null,
    removing: [],
  });
  await view.refresh();
  readGate.resolve(page);
  writing.resolve();
  await read;
  expect(await firstWrite).toBe("unavailable");
  expect(view.getSnapshot()).toEqual({
    status: "ready",
    value: empty,
    removing: [],
  });
  view.close();
});

test.each(["close", "deny read"] as const)(
  "%s prevents an old write from changing a retired snapshot",
  async (end) => {
    const account = mockAccount();
    const gate = heldWrite();
    account.readSavedPosts
      .mockResolvedValueOnce(page)
      .mockRejectedValueOnce(
        new ResponseError(new Response(null, { status: 403 })),
      );
    account.setPostSaved.mockReturnValueOnce(gate.promise);
    const view = openPostCollection(account, { kind: "all" });
    await view.refresh();
    const pending = view.remove(last.id);
    await Promise.resolve();
    if (end === "close") view.close();
    else await view.refresh();
    expect(account.setPostSaved.mock.calls[0][2]?.aborted).toBe(true);
    gate.resolve();
    expect(await pending).toBe("unavailable");
    expect(view.getSnapshot()).toEqual({
      status: end === "close" ? "closed" : "forbidden",
      value: null,
      removing: [],
    });
  },
);

test("closing in the removing notification prevents sending the write", async () => {
  const account = mockAccount();
  account.readSavedPosts.mockResolvedValue(page);
  const view = openPostCollection(account, { kind: "all" });
  await view.refresh();
  view.subscribe(() => {
    if (view.getSnapshot().removing.length) view.close();
  });
  expect(await view.remove(first.id)).toBe("unavailable");
  expect(account.setPostSaved).not.toHaveBeenCalled();
});
