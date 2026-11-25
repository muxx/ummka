import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import type { TeamWorkspace } from "../entry/AccountTeamWindow.tsx";
import type { LocalPost } from "../mattermost/local-history.ts";
import { projectTeamSidebar } from "../mattermost/team-sidebar.ts";
import {
  sidebarPreferences,
  workspaceServerPolicy,
} from "../mattermost/workspace-preferences.ts";
import { ChannelsWorkspace } from "./ChannelsWorkspace.tsx";
import "./workspace-dom.test-utils.ts";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(cleanup);
type Connection = TeamWorkspace["connection"];
const userId = "u".repeat(26);
const team = {
  id: "t".repeat(26),
  name: "winter",
  displayName: "Winter",
  roles: "",
  preferenceRank: null,
};
const general = "g".repeat(26);
const design = "d".repeat(26);
const root = {
  id: "r".repeat(26),
  channelId: general,
  userId,
  rootId: "",
  message: "Original question",
  createAt: 100,
  updateAt: 100,
  editAt: 0,
  deleteAt: 0,
  type: "",
  hashtags: "",
  isPinned: false,
};
const reply = {
  ...root,
  id: "s".repeat(26),
  rootId: root.id,
  message: "Selected reply",
  createAt: 200,
  updateAt: 200,
};
const page = { kind: "page" as const, root, replies: [reply], next: null };

function mount(collapsed: boolean, online = true) {
  const data = projectTeamSidebar({
    teamId: team.id,
    channels: [
      [general, "General"],
      [design, "Design"],
    ].map(([id, name]) => ({
      channel: { id, name, displayName: name, type: "O", deleteAt: 0 },
      membership: { channelId: id, userId, roles: "writer" },
    })),
    categories: [
      {
        id: "joined",
        type: "channels",
        displayName: "Channels",
        sorting: "manual",
        collapsed: false,
        muted: false,
        channelIds: [general, design],
      },
    ],
  });
  const rows: LocalPost[] = [
    {
      ...root,
      rootId: null,
      messageSource: null,
      ...(collapsed && {
        threadSummary: {
          replyCount: 1,
          lastReplyAt: reply.createAt,
          participantIds: [userId],
        },
      }),
    },
  ];
  if (!collapsed) rows.push({ ...reply, messageSource: null });
  const readThreadPage = vi
    .fn<Connection["readThreadPage"]>()
    .mockResolvedValue(page);
  const connection = {
    rid: 1,
    readTeamSidebar: vi
      .fn()
      .mockResolvedValue({ selectedChannel: general, data }),
    refreshTeamSidebar: vi.fn(),
    selectSidebarChannel: vi.fn().mockResolvedValue(true),
    readSavedTeamRoles: vi.fn().mockResolvedValue({
      systemRoles: "",
      definitions: [{ name: "writer", permissions: ["create_post"] }],
    }),
    refreshTeamRoles: vi.fn(),
    readSavedProfiles: vi
      .fn()
      .mockResolvedValue({ profiles: {}, usernames: {} }),
    refreshSavedProfiles: vi.fn(),
    readChannelWindow: vi.fn<Connection["readChannelWindow"]>(
      async ({ channelId }) => ({
        posts: channelId === general ? rows : [],
        older: { kind: "end" },
        newer: { kind: "end" },
        firstInaccessiblePostTime: 0,
      }),
    ),
    refreshChannelHistory: vi.fn(),
    readThreadPage,
    readSavedPost: vi
      .fn<Connection["readSavedPost"]>()
      .mockResolvedValue(rows[0]),
    readDraft: vi.fn().mockResolvedValue({ message: "", revision: null }),
    saveDraft: vi.fn<Connection["saveDraft"]>(async ({ message }) => ({
      kind: "saved",
      draft: { message, revision: "saved" },
    })),
    readPendingPosts: vi.fn().mockResolvedValue([]),
    subscribeToPostActivity: vi.fn(() => () => {}),
  };
  const workspace: TeamWorkspace = {
    connection: connection as unknown as Connection,
    serverUrl: "https://chat.example.test",
    userId,
    team,
    online,
    directoryNotice: null,
    chooseAnotherTeam: vi.fn(),
    sessionIssue: vi.fn(),
    policy: {
      server: {
        status: "ready",
        value: workspaceServerPolicy(
          {
            CollapsedThreads: collapsed ? "always_on" : "disabled",
          },
          {},
        ),
      },
      user: sidebarPreferences(userId, []),
      userReadFailed: false,
      retry: vi.fn(),
    },
  };
  render(
    <ChannelsWorkspace workspace={workspace} language="en" onEnded={vi.fn()} />,
  );
  return connection;
}

test("opens a root by its reply count and returns focus to the same message with its channel draft intact", async () => {
  const connection = mount(true);
  const draft = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #General…",
  });
  fireEvent.change(draft, { target: { value: "Unsent channel draft" } });
  const open = await screen.findByRole("button", {
    name: /Open thread, 1 reply/,
  });
  open.focus();
  fireEvent.click(open);
  const pane = await screen.findByRole("complementary", { name: "Thread" });
  expect(await within(pane).findByText(reply.message)).toBeTruthy();
  expect(within(pane).getByText(root.message)).toBeTruthy();
  expect(connection.readThreadPage.mock.calls.map(([query]) => query)).toEqual([
    {
      channelId: general,
      rootId: root.id,
      direction: "down",
      collapsedThreads: true,
      cursor: undefined,
    },
  ]);
  fireEvent.click(within(pane).getByRole("button", { name: "Close thread" }));
  expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
  expect(document.activeElement).toBe(open);
  expect(screen.getByRole("textbox", { name: "Message #General…" })).toBe(
    draft,
  );
  expect(draft.value).toBe("Unsent channel draft");
});

test("opens a flat reply around its timestamp and ID, then discards both responses when the channel changes", async () => {
  const connection = mount(false);
  let resolve!: (result: typeof page) => void;
  const late = new Promise<typeof page>((done) => {
    resolve = done;
  });
  connection.readThreadPage.mockReturnValue(late);
  const row = (await screen.findByText(reply.message)).closest("article");
  if (!row) throw new Error("Missing reply in channel history");
  fireEvent.click(within(row).getByRole("button", { name: "Open thread" }));
  const pane = await screen.findByRole("complementary", { name: "Thread" });
  expect(await within(pane).findByText(reply.message)).toBeTruthy();
  await waitFor(() =>
    expect(connection.readThreadPage).toHaveBeenCalledTimes(2),
  );
  expect(connection.readThreadPage.mock.calls.map(([query]) => query)).toEqual(
    ["up", "down"].map((direction) => ({
      direction,
      channelId: general,
      rootId: root.id,
      collapsedThreads: false,
      cursor: { id: reply.id, createAt: reply.createAt },
    })),
  );
  fireEvent.click(screen.getByRole("button", { name: "Design" }));
  await screen.findByRole("heading", { name: "Design" });
  expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
  expect(
    connection.readThreadPage.mock.calls.every(([, signal]) => signal?.aborted),
  ).toBe(true);
  await act(async () => resolve(page));
  expect(screen.queryByText(root.message)).toBeNull();
  expect(screen.queryByText(reply.message)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "General" }));
  await screen.findByText(reply.message);
  expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
  expect(connection.readThreadPage).toHaveBeenCalledTimes(2);
});

test("removes both cached messages when the server denies access to the thread", async () => {
  const connection = mount(false);
  let reject!: (error: Error) => void;
  const pending = new Promise<typeof page>((_, fail) => {
    reject = fail;
  });
  connection.readThreadPage.mockReturnValue(pending);
  const row = (await screen.findByText(reply.message)).closest("article");
  if (!row) throw new Error("Missing reply in channel history");
  const open = within(row).getByRole("button", { name: "Open thread" });
  fireEvent.click(open);
  const pane = await screen.findByRole("complementary", { name: "Thread" });
  expect(await within(pane).findByText(root.message)).toBeTruthy();
  expect(within(pane).getByText(reply.message)).toBeTruthy();
  await act(async () =>
    reject(new ResponseError(new Response(null, { status: 403 }))),
  );
  expect(within(pane).getByRole("alert").textContent).toMatch(
    /no longer available/i,
  );
  expect(within(pane).queryByText(root.message)).toBeNull();
  expect(within(pane).queryByText(reply.message)).toBeNull();
  expect(
    within(pane).queryByRole("button", { name: /retry|again/i }),
  ).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
  expect(document.activeElement).toBe(open);
});

test("an offline thread preserves the saved root and leaves missing replies open", async () => {
  const connection = mount(true, false);
  const open = await screen.findByRole("button", {
    name: /Open thread, 1 reply/,
  });
  fireEvent.click(open);
  const pane = await screen.findByRole("complementary", { name: "Thread" });
  expect(await within(pane).findByText(root.message)).toBeTruthy();
  expect(
    within(pane).getByText("Later replies haven’t been loaded."),
  ).toBeTruthy();
  expect(within(pane).queryByText("No replies yet.")).toBeNull();
  expect(connection.readThreadPage).not.toHaveBeenCalled();
});

test("retrying an earlier page keeps focus at the earlier edge while the other page arrives", async () => {
  const connection = mount(false);
  let finishEarlier!: (result: typeof page) => void;
  let finishLater!: (result: typeof page) => void;
  let attempts = 0;
  connection.readThreadPage.mockImplementation(async ({ direction }) => {
    if (direction === "down")
      return new Promise((resolve) => {
        finishLater = resolve;
      });
    if (!attempts++) throw Error("offline");
    return new Promise((resolve) => {
      finishEarlier = resolve;
    });
  });
  const channelRow = (await screen.findByText(reply.message)).closest(
    "article",
  );
  if (!channelRow) throw Error("Missing flat reply");
  fireEvent.click(
    within(channelRow).getByRole("button", { name: "Open thread" }),
  );
  const pane = await screen.findByRole("complementary", { name: "Thread" });
  const retry = await within(pane).findByRole("button", {
    name: /earlier replies.*Try again/,
  });
  expect(document.activeElement).toBe(
    within(pane).getByText(reply.message).closest("article"),
  );
  retry.focus();
  fireEvent.click(retry, { detail: 0 });
  await waitFor(() => expect(finishEarlier).toBeTypeOf("function"));
  const newer = {
    ...reply,
    id: "n".repeat(26),
    createAt: 300,
    message: "Later reply",
  };
  await act(async () => finishLater({ ...page, replies: [newer] }));
  expect(document.activeElement?.getAttribute("data-thread-edge")).toBe("up");
  const older = {
    ...reply,
    id: "o".repeat(26),
    createAt: 150,
    message: "Earlier reply",
  };
  await act(async () => finishEarlier({ ...page, replies: [older] }));
  expect(document.activeElement).toBe(
    within(pane).getByText(older.message).closest("article"),
  );
  expect(
    within(pane)
      .getAllByRole("article")
      .map((row) => row.getAttribute("data-post-id")),
  ).toEqual([root.id, older.id, reply.id, newer.id]);
});
