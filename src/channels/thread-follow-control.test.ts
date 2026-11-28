import { expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { openThreadFollowControl } from "./thread-follow-control.ts";
import { openThreadReplyWindow } from "./thread-reply-window.ts";

type Account = Parameters<typeof openThreadFollowControl>[0];
const channelId = "c".repeat(26),
  rootId = "r".repeat(26),
  teamId = "t".repeat(26);
const scope = { channelId, rootId, collapsedThreads: true };
const cursor = { id: "p".repeat(26), createAt: 101 };
function page(
  isFollowing: boolean | undefined,
  next: typeof cursor | null = null,
) {
  return {
    kind: "page" as const,
    next,
    replies: [],
    root: {
      id: rootId,
      channelId,
      userId: "u".repeat(26),
      rootId: "",
      createAt: 100,
      updateAt: 100,
      editAt: 0,
      deleteAt: 0,
      message: "Question",
      hashtags: "",
      isPinned: false,
      type: "",
      isFollowing,
    },
  };
}
function setup() {
  const account = {
    readThreadPage: vi
      .fn<Account["readThreadPage"]>()
      .mockResolvedValue(page(false)),
    setThreadFollowing: vi
      .fn<Account["setThreadFollowing"]>()
      .mockResolvedValue(),
  };
  const reader = openThreadReplyWindow(account, scope);
  const confirmed = vi.fn();
  const control = openThreadFollowControl(
    account,
    teamId,
    channelId,
    rootId,
    reader,
    confirmed,
  );
  return { ...account, reader, control, confirmed };
}
function rejection(status: number) {
  return new ResponseError(
    new Response(
      JSON.stringify({ id: "fixture.refused", status_code: status }),
      { status },
    ),
  );
}

test("a page that was in flight before the write cannot replace the acknowledged value", async () => {
  const { reader, control, readThreadPage, setThreadFollowing, confirmed } =
    setup();
  let finish!: (value: ReturnType<typeof page>) => void;
  readThreadPage.mockResolvedValueOnce(page(false, cursor)).mockReturnValueOnce(
    new Promise((done) => {
      finish = done;
    }),
  );
  expect(control.getSnapshot().value).toBeUndefined();
  await reader.open();
  const next = reader.more("down");
  await Promise.resolve();
  await control.toggle();
  finish(page(false));
  await next;
  expect(control.getSnapshot()).toEqual({ value: true, phase: "ready" });
  expect(setThreadFollowing).toHaveBeenCalledExactlyOnceWith(
    teamId,
    { id: rootId, rootId: null },
    true,
    expect.any(AbortSignal),
  );
  expect(readThreadPage).toHaveBeenCalledTimes(2);
  expect(confirmed).toHaveBeenCalledExactlyOnceWith(rootId, true);
});

test("a lost acknowledgement requires a read and never automatically repeats the write", async () => {
  const { reader, control, readThreadPage, setThreadFollowing, confirmed } =
    setup();
  await reader.open();
  setThreadFollowing.mockRejectedValueOnce(new TypeError("Disconnected"));
  await control.toggle();
  expect(control.getSnapshot()).toEqual({ phase: "unknown", wanted: true });
  await control.toggle();
  expect(setThreadFollowing).toHaveBeenCalledOnce();
  expect(readThreadPage).toHaveBeenCalledOnce();
  expect(confirmed).not.toHaveBeenCalled();
  readThreadPage
    .mockRejectedValueOnce(rejection(503))
    .mockResolvedValueOnce(page(true));
  await control.check();
  expect(control.getSnapshot()).toEqual({ phase: "unknown", wanted: true });
  await control.check();
  expect(readThreadPage).toHaveBeenLastCalledWith(
    { ...scope, direction: "down", perPage: 1 },
    expect.any(AbortSignal),
  );
  expect(control.getSnapshot()).toEqual({ value: true, phase: "ready" });
  expect(confirmed).toHaveBeenCalledExactlyOnceWith(rootId, true);
  expect(setThreadFollowing).toHaveBeenCalledOnce();
});

test("a confirmed refusal keeps the previous value for an explicit retry", async () => {
  const { reader, control, setThreadFollowing, confirmed } = setup();
  await reader.open();
  setThreadFollowing.mockRejectedValueOnce(rejection(400));
  await control.toggle();
  expect(control.getSnapshot()).toEqual({
    value: false,
    phase: "refused",
    wanted: true,
  });
  expect(confirmed).not.toHaveBeenCalled();
  await control.toggle();
  expect(control.getSnapshot()).toEqual({ value: true, phase: "ready" });
});

test.each([
  [401, "unauthorized"],
  [403, "forbidden"],
  [404, "forbidden"],
] as const)(
  "an HTTP %i on the subscription removes the private thread",
  async (code, expected) => {
    const { reader, control, readThreadPage, setThreadFollowing, confirmed } =
      setup();
    await reader.open();
    setThreadFollowing.mockRejectedValueOnce(rejection(code));
    if (code !== 401) readThreadPage.mockRejectedValueOnce(rejection(code));
    await control.toggle();
    expect(reader.getSnapshot()).toMatchObject({
      root: null,
      replies: [],
      unavailable: expected,
    });
    expect(control.getSnapshot().value).toBeUndefined();
    expect(confirmed).not.toHaveBeenCalled();
  },
);

test("an inaccessible recheck clears the open pane, including its previous subscription", async () => {
  const { reader, control, readThreadPage, confirmed } = setup();
  await reader.open();
  readThreadPage.mockResolvedValueOnce({
    kind: "inaccessible",
    firstInaccessiblePostTime: 101,
  });
  await control.check();
  expect(reader.getSnapshot()).toMatchObject({
    root: null,
    unavailable: "limited",
    firstInaccessiblePostTime: 101,
  });
  expect(control.getSnapshot().value).toBeUndefined();
  expect(confirmed).not.toHaveBeenCalled();
});

test.each([true, false])(
  "a confirmed reply rereads the server's own automatic subscription setting (%s)",
  async (value) => {
    const { reader, control, readThreadPage, setThreadFollowing, confirmed } =
      setup();
    await reader.open();
    let complete!: () => void;
    setThreadFollowing.mockReturnValueOnce(
      new Promise((done) => {
        complete = done;
      }),
    );
    const writing = control.toggle();
    control.acceptedReply();
    control.acceptedReply();
    await control.toggle();
    expect(readThreadPage).toHaveBeenCalledOnce();
    readThreadPage.mockResolvedValueOnce(page(value));
    complete();
    await writing;
    expect(confirmed.mock.calls).toEqual([
      [rootId, true],
      [rootId, value],
    ]);
    expect(readThreadPage).toHaveBeenCalledTimes(2);
    expect(setThreadFollowing).toHaveBeenCalledOnce();
    expect(control.getSnapshot()).toEqual({ value, phase: "ready" });
  },
);

test("closing or revoking a thread discards late results and queued reply reads", async () => {
  for (const close of [true, false]) {
    const { reader, control, readThreadPage, setThreadFollowing, confirmed } =
      setup();
    await reader.open();
    let complete!: () => void;
    setThreadFollowing.mockReturnValueOnce(
      new Promise((done) => {
        complete = done;
      }),
    );
    const writing = control.toggle();
    control.acceptedReply();
    if (close) control.close();
    else reader.unavailable("session");
    expect(setThreadFollowing.mock.calls[0][3]?.aborted).toBe(true);
    complete();
    await writing;
    expect(confirmed).not.toHaveBeenCalled();
    expect(readThreadPage).toHaveBeenCalledOnce();
  }
});

test("a write refusal with read access leaves the thread available for an explicit retry", async () => {
  const { reader, control, readThreadPage, setThreadFollowing, confirmed } =
    setup();
  await reader.open();
  setThreadFollowing.mockRejectedValueOnce(rejection(403));
  await control.toggle();
  expect(readThreadPage).toHaveBeenCalledTimes(2);
  expect(reader.getSnapshot().root?.id).toBe(rootId);
  expect(control.getSnapshot()).toEqual({
    value: false,
    phase: "refused",
    wanted: true,
  });
  expect(confirmed).not.toHaveBeenCalled();
  await control.toggle();
  expect(confirmed).toHaveBeenCalledExactlyOnceWith(rootId, true);
});

test.each([false, true])(
  "a root read without confirmed subscription offers a check without writing (read error %s)",
  async (failed) => {
    const { reader, control, readThreadPage, setThreadFollowing, confirmed } =
      setup();
    if (failed) readThreadPage.mockRejectedValueOnce(rejection(503));
    else readThreadPage.mockResolvedValueOnce(page(undefined));
    expect(control.getSnapshot()).toEqual({ phase: "ready" });
    await reader.open();
    expect(control.getSnapshot()).toEqual({ phase: "unknown" });
    await control.toggle();
    expect(setThreadFollowing).not.toHaveBeenCalled();
    await control.check();
    expect(control.getSnapshot()).toEqual({ value: false, phase: "ready" });
    expect(readThreadPage).toHaveBeenCalledTimes(2);
    expect(confirmed).toHaveBeenCalledExactlyOnceWith(rootId, false);
  },
);
