import { expect, test, vi } from "vitest";
import { FetchError, ResponseError } from "../../vendor/mattermost/index.js";
import type { LocalChannelWindow } from "../mattermost/local-history.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import { workspacePreferences } from "../mattermost/workspace-preferences.ts";
import {
  observeWorkspaceRead,
  openingChannel,
  readTimelineEdge,
  type WorkspaceRead,
  workspaceFailure,
  workspaceProfileQuery,
} from "./workspace-data.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

const id = (n: number) => String(n).padStart(26, "0");
const user = id(1);
function room(
  n: number,
  kind: "O" | "P" | "D" | "G",
  changes: Partial<TeamSidebar["data"]["channels"][number]> = {},
) {
  return {
    id: id(n),
    kind,
    name: "room-" + n,
    displayName: "Room " + n,
    header: "",
    purpose: "",
    createAt: 1,
    deleteAt: 0,
    muted: false,
    totalMsgCount: 5,
    totalMsgCountRoot: 2,
    lastPostAt: 201,
    lastRootPostAt: 200,
    lastViewedAt: 30,
    msgCount: 5,
    msgCountRoot: 2,
    mentionCount: 0,
    mentionCountRoot: 0,
    urgentMentionCount: 0,
    ...changes,
  };
}
function snapshot(
  channels: TeamSidebar["data"]["channels"],
  selectedChannel: string | null = null,
): TeamSidebar {
  return { data: { channels, categories: [] }, selectedChannel };
}
function page(
  numbers: number[],
  older: number | null = null,
): LocalChannelWindow {
  return {
    posts: numbers.map((n) => ({
      id: id(n),
      channelId: id(20),
      userId: user,
      createAt: 100,
      updateAt: 200,
      editAt: 0,
      type: "",
      rootId: null,
      message: "message " + n,
      messageSource: null,
      hashtags: "",
      isPinned: false,
    })),
    newer: { kind: "end" },
    older:
      older === null ? { kind: "end" } : { kind: "more", postId: id(older) },
    firstInaccessiblePostTime: 0,
  };
}

test("restores the selected joined conversation before Town Square and ordered channels", () => {
  const archived = room(1, "O", { deleteAt: 3 }),
    direct = room(2, "D"),
    general = room(3, "O", { name: "town-square" }),
    privateRoom = room(4, "P", { displayName: "Room 2" }),
    publicRoom = room(5, "O", { displayName: "Room 10" });
  expect(openingChannel(snapshot([general, archived], archived.id), "ru")).toBe(
    archived,
  );
  expect(openingChannel(snapshot([privateRoom, general, direct]), "en")).toBe(
    general,
  );
  expect(
    openingChannel(snapshot([archived, publicRoom, direct, privateRoom]), "en"),
  ).toBe(privateRoom);
  expect(openingChannel(snapshot([archived, direct]), "en")).toBeNull();
});

test("looks up the account, visible direct partners, group names and visible authors once", () => {
  const peer = id(5),
    other = id(6),
    disabled = id(7);
  const data = snapshot(
    [
      room(30, "D", { name: `${user}__${peer}` }),
      room(31, "D", { name: `${user}__${other}`, mentionCountRoot: 1 }),
      room(32, "D", {
        name: `${user}__${disabled}`,
        muted: true,
        totalMsgCountRoot: 15,
      }),
      room(33, "G", { displayName: "alex, ada, alex" }),
      room(34, "G", { displayName: "private, outside" }),
      room(35, "O"),
    ],
    id(33),
  );
  const policy = workspacePreferences(
    user,
    [
      {
        userId: user,
        category: "direct_channel_show",
        name: peer,
        value: "true",
      },
    ],
    { CollapsedThreads: "always_on" },
    {},
  );
  const timeline = page([8, 7]);
  timeline.posts[0].userId = id(9);
  expect(workspaceProfileQuery(user, data, policy, timeline)).toEqual({
    ids: [user, id(9), peer, other],
    usernames: ["alex", "ada"],
  });
  expect(
    workspaceProfileQuery(
      user,
      snapshot(Array.from({ length: 5000 }, (_, n) => room(n, "O"))),
      policy,
      null,
    ),
  ).toEqual({ ids: [user], usernames: [] });
});

test("publishes local content before the network and rereads an externally superseded write", async () => {
  const wait = deferred<void>(),
    pending = deferred<void>();
  const read = vi
    .fn<() => Promise<string | null>>()
    .mockResolvedValueOnce("cached")
    .mockResolvedValueOnce("other process");
  const states: WorkspaceRead<string>[] = [];
  const result = observeWorkspaceRead({
    signal: new AbortController().signal,
    online: true,
    read,
    refresh: async () => {
      pending.resolve();
      await wait.promise;
      return false;
    },
    publish: (v) => states.push(v),
  });
  await pending.promise;
  expect(states).toEqual([{ value: "cached", status: "refreshing" }]);
  wait.resolve();
  await result;
  expect(states.at(-1)).toEqual({ value: "other process", status: "ready" });
  const offline = vi.fn();
  await observeWorkspaceRead<string>({
    signal: new AbortController().signal,
    online: false,
    read: async () => null,
    refresh: offline,
    publish: (v) => states.push(v),
  });
  expect(offline).not.toHaveBeenCalled();
  expect(states.at(-1)).toEqual({ value: null, status: "offline" });
});

test("prevents a late A after switching to B and distinguishes storage, network and access denial", async () => {
  const a = new AbortController();
  const pending = deferred<string>();
  const rendered = vi.fn();
  const task = observeWorkspaceRead({
    signal: a.signal,
    online: true,
    read: () => pending.promise,
    refresh: vi.fn(),
    publish: rendered,
  });
  a.abort();
  pending.resolve("A");
  await observeWorkspaceRead({
    signal: new AbortController().signal,
    online: false,
    read: async () => "B",
    refresh: vi.fn(),
    publish: rendered,
  });
  await task;
  expect(rendered.mock.calls).toEqual([[{ value: "B", status: "offline" }]]);
  for (const [error, status, value] of [
    [new TypeError("offline"), "network", "old"],
    ["history_storage_unavailable", "storage", "old"],
    ["invalid_history_request", "storage", "old"],
    [new ResponseError(new Response("", { status: 403 })), "forbidden", null],
    [
      new ResponseError(new Response("", { status: 401 })),
      "unauthorized",
      null,
    ],
    ["session_unavailable", "session", null],
  ] as const) {
    await observeWorkspaceRead({
      signal: new AbortController().signal,
      online: true,
      read: async () => "old",
      refresh: async () => {
        throw error;
      },
      publish: rendered,
    });
    expect(rendered).toHaveBeenLastCalledWith({ value, status });
  }
  expect(
    workspaceFailure(
      new FetchError(
        new TypeError("failed", { cause: "session_unavailable" }),
        "request failed",
      ),
      "network",
    ),
  ).toBe("session");
});

test("uses the visible boundary, preserves equal timestamps and advances through cached history offline", async () => {
  const current = page([12, 11], 10),
    expanded = page([12, 11, 10, 9], 8);
  const native = {
    readChannelWindow: vi.fn().mockResolvedValue(expanded),
    refreshChannelHistory: vi.fn(),
  };
  const query = () =>
    readTimelineEdge(
      native,
      id(20),
      true,
      current,
      "older",
      id(10),
      false,
      new AbortController().signal,
    );
  expect(await query()).toEqual({ status: "ready", page: expanded });
  expect(native.readChannelWindow).toHaveBeenCalledWith({
    channelId: id(20),
    collapsedThreads: true,
    kind: "around",
    postId: id(11),
    newer: 20,
    older: 60,
  });
  expect(native.refreshChannelHistory).not.toHaveBeenCalled();
  native.readChannelWindow.mockResolvedValue(current);
  expect(await query()).toEqual({ status: "offline" });
  const invalid = await readTimelineEdge(
    native,
    id(20),
    true,
    current,
    "older",
    id(99),
    true,
    new AbortController().signal,
  );
  expect(invalid).toEqual({ status: "unavailable" });
  expect(native.refreshChannelHistory).not.toHaveBeenCalled();
});

test("rereads a network edge from the known post and respects retention, interruption and lack of progress", async () => {
  const current = page([12, 11], 10),
    expanded = page([12, 11, 10, 9]);
  const read = vi
    .fn()
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce(expanded);
  const refresh = vi.fn().mockResolvedValue({ kind: "applied" });
  const native = { readChannelWindow: read, refreshChannelHistory: refresh };
  const controller = new AbortController();
  const next = () =>
    readTimelineEdge(
      native,
      id(20),
      false,
      current,
      "older",
      id(10),
      true,
      controller.signal,
    );
  expect(await next()).toEqual({ status: "ready", page: expanded });
  expect(refresh).toHaveBeenCalledWith(
    {
      channelId: id(20),
      collapsedThreads: false,
      kind: "before",
      postId: id(11),
      perPage: 60,
    },
    controller.signal,
  );
  const cutoff = { ...page([12, 11]), firstInaccessiblePostTime: 500 };
  read
    .mockResolvedValue(current)
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce(cutoff);
  expect(await next()).toEqual({ status: "ready", page: cutoff });
  const reads = refresh.mock.calls.length;
  read.mockResolvedValueOnce(cutoff);
  expect(await next()).toEqual({ status: "ready", page: cutoff });
  expect(refresh).toHaveBeenCalledTimes(reads);
  expect(await next()).toEqual({ status: "unavailable" });
  refresh.mockImplementationOnce(async () => {
    controller.abort(Error("left channel"));
    return { kind: "applied" };
  });
  await expect(next()).rejects.toThrow("left channel");
  const up = {
    ...page([12, 11]),
    newer: { kind: "more" as const, postId: id(13) },
  };
  read.mockResolvedValueOnce(up).mockResolvedValueOnce(page([14, 13, 12, 11]));
  expect(
    (
      await readTimelineEdge(
        native,
        id(20),
        false,
        up,
        "newer",
        id(13),
        true,
        new AbortController().signal,
      )
    ).status,
  ).toBe("ready");
  expect(refresh.mock.lastCall?.[0]).toMatchObject({
    kind: "after",
    postId: id(12),
  });
});
