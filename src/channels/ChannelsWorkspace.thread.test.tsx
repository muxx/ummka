import { onBackButtonPress } from "@tauri-apps/api/app";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { isAndroid, usesMacOSOverlay } from "../build-platform.ts";
import * as clipboardPolicy from "../device/clipboard-policy.ts";
import type { TeamWorkspace } from "../entry/AccountTeamWindow.tsx";
import type { PendingPost } from "../mattermost/account-delivery.ts";
import { createChannelHistoryChanges } from "../mattermost/channel-history-changes.ts";
import { channelPostChange } from "../mattermost/channel-post-records.ts";
import { channelProfile } from "../mattermost/channel-profiles.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import type {
  ComposerDraft,
  DraftLocation,
} from "../mattermost/native-rest.ts";
import { outgoingRowState } from "../mattermost/outgoing-row-state.ts";
import { createSavedPostState } from "../mattermost/saved-post-state.ts";
import { projectTeamSidebar } from "../mattermost/team-sidebar.ts";
import {
  sidebarPreferences,
  workspaceServerPolicy,
} from "../mattermost/workspace-preferences.ts";
import { ChannelsWorkspace } from "./ChannelsWorkspace.tsx";
import { createChannelBookmarkWrites } from "./channel-bookmark-writes.ts";
import {
  ChannelEventTargetContext,
  type OpenEventTarget,
} from "./use-account-post-observer.ts";
import * as workspaceSearch from "./use-workspace-search.tsx";
import "./workspace-dom.test-utils.ts";

let androidBack: (() => void) | undefined;
vi.mock("@tauri-apps/api/app", () => ({
  onBackButtonPress: vi.fn(async (pressed: () => void) => {
    androidBack = pressed;
    return {
      unregister: vi.fn(() => {
        if (androidBack === pressed) androidBack = undefined;
      }),
    };
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(clipboardPolicy, "observeClipboardAllowed").mockImplementation(
    (report) => {
      report(true);
      return () => {};
    },
  );
  vi.spyOn(clipboardPolicy, "readClipboardAllowed").mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
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
const foreign = "z".repeat(26);
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
const secondRoot = { ...root, id: "x".repeat(26), message: "Another question" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

function mount(
  collapsed: boolean,
  online = true,
  options: {
    archived?: boolean;
    direct?: "D" | "G";
    directProfile?: ReturnType<typeof channelProfile>;
    rootAuthor?: string;
    pending?: PendingPost;
    writable?: boolean;
    directDesign?: boolean;
    type?: string;
    second?: boolean;
    draftRead?: Promise<void>;
    savedReading?: boolean;
    contents?: Pick<LocalPost, "message" | "attachments">;
    viewer?: string;
    coordination?: ReturnType<typeof createThreadReadCoordination>;
    directoryPermissions?: string[];
    eventSlot?: { current: OpenEventTarget | null };
  } = {},
) {
  const data = projectTeamSidebar({
    teamId: team.id,
    channels: [
      [general, "General"],
      [design, "Design"],
    ].map(([id, name]) => ({
      channel: {
        id,
        name:
          options.directDesign && id === design
            ? [userId, foreign].sort().join("__")
            : options.direct && id === general
              ? [userId, "v".repeat(26)].join("__")
              : name,
        displayName: name,
        type:
          options.directDesign && id === design
            ? "D"
            : id === general
              ? (options.direct ?? "O")
              : "O",
        deleteAt: options.archived && id === general ? 300 : 0,
      },
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
      userId: options.rootAuthor ?? userId,
      type: options.type ?? root.type,
      ...options.contents,
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
  if (options.second)
    rows.push({ ...secondRoot, rootId: null, messageSource: null });
  const { message: replyMessage, attachments: replyFiles } =
    options.contents ?? {};
  const redactedFileCount = replyFiles?.redactedFileCount;
  const readThreadPage = vi
    .fn<Connection["readThreadPage"]>()
    .mockImplementation(async ({ rootId }) =>
      rootId === secondRoot.id
        ? { ...page, root: secondRoot, replies: [] }
        : {
            ...page,
            root: { ...root, type: options.type ?? root.type },
            replies: [
              {
                ...reply,
                message: replyMessage ?? reply.message,
                fileIds: redactedFileCount ? [] : replyFiles?.fileIds,
                metadata: replyFiles && {
                  files: redactedFileCount ? [] : replyFiles.files,
                  redactedFileCount,
                },
              },
            ],
          },
    );
  const drafts = new Map<string, ComposerDraft>();
  const draftKey = ({ channelId, rootId }: DraftLocation) =>
    JSON.stringify([channelId, rootId]);
  let revision = 0;
  const changes = createChannelHistoryChanges();
  const saved = createSavedPostState();
  if (!options.savedReading)
    saved.publish(saved.beginRead(), { ids: new Set(), upperBound: 0 });
  const writeSavedPost = vi
    .fn<Connection["setPostSaved"]>()
    .mockResolvedValue(undefined);
  const connection = {
    subscribeToChannelHistory: changes.subscribe,
    notifyChannelHistoryChanged: changes.notify,
    getSavedPostPresentation: saved.getPresentation,
    getSavedPostState: saved.get,
    isSavedPostPending: saved.isPending,
    subscribeToSavedPostState: saved.subscribe,
    setPostSaved: (id: string, on: boolean) =>
      saved.runWrite(id, on, async () => {
        await writeSavedPost(id, on);
        saved.record(id, on);
      }),
    readRecentTeamSearches: vi.fn(async () => []),
    rememberTeamSearch: vi.fn(async () => true),
    readSearchTimezone: vi.fn(async () => "UTC"),
    readPostSearchPage: vi.fn(async () => ({
      items: [
        {
          id: reply.id,
          channelId: general,
          userId,
          message: "Found in search",
        },
      ],
      isEnd: true,
      firstInaccessiblePostTime: 0,
      matches: null,
    })),
    rid: 1,
    readFollowedThreadTotals: vi
      .fn<Connection["readFollowedThreadTotals"]>()
      .mockResolvedValue({
        total: 2,
        totalUnreadThreads: 1,
        totalUnreadMentions: 0,
        totalUnreadUrgentMentions: 0,
      }),
    readFollowedThreads: vi
      .fn<Connection["readFollowedThreads"]>()
      .mockResolvedValue({ items: [], nextBefore: null }),
    readPostDestination: vi.fn<Connection["readPostDestination"]>(),
    readPostAnchor: vi.fn<Connection["readPostAnchor"]>(),
    readFollowedThreadState: vi.fn<Connection["readFollowedThreadState"]>(),
    markFollowedThreadRead: vi.fn<Connection["markFollowedThreadRead"]>(),
    readTeamSidebar: vi
      .fn()
      .mockResolvedValue({ selectedChannel: general, data }),
    refreshTeamSidebar: vi.fn(),
    selectSidebarChannel: vi.fn().mockResolvedValue(true),
    readSavedTeamRoles: vi.fn().mockResolvedValue({
      systemRoles: options.directoryPermissions ? "writer" : "",
      definitions: [
        {
          name: "writer",
          permissions: [
            ...(options.writable === false ? [] : ["create_post"]),
            ...(options.directoryPermissions ?? []),
          ],
        },
      ],
    }),
    refreshTeamRoles: vi.fn(),
    readChannelDirectoryPage: vi
      .fn<Connection["readChannelDirectoryPage"]>()
      .mockResolvedValue({ items: [], hasMore: false }),
    searchChannelDirectory: vi
      .fn<Connection["searchChannelDirectory"]>()
      .mockResolvedValue([]),
    changeOwnMembership: vi.fn<Connection["changeOwnMembership"]>(),
    readSavedProfiles: vi.fn().mockResolvedValue(
      options.directProfile
        ? {
            profiles: { [options.directProfile.id]: options.directProfile },
            usernames: {
              [options.directProfile.username]: options.directProfile.id,
            },
          }
        : { profiles: {}, usernames: {} },
    ),
    refreshSavedProfiles: vi
      .fn<Connection["refreshSavedProfiles"]>()
      .mockResolvedValue(options.directProfile ? [options.directProfile] : []),
    readChannelWindow: vi.fn<Connection["readChannelWindow"]>(
      async ({ channelId }) => ({
        posts: channelId === general ? rows : [],
        older: { kind: "end" },
        newer: { kind: "end" },
        firstInaccessiblePostTime: 0,
      }),
    ),
    refreshChannelHistory: vi.fn(),
    readPostFiles: vi.fn<Connection["readPostFiles"]>().mockResolvedValue([]),
    applyChannelPostEvents: vi.fn<Connection["applyChannelPostEvents"]>(),
    readThreadPage,
    setThreadFollowing: vi
      .fn<Connection["setThreadFollowing"]>()
      .mockResolvedValue(),
    readSavedPost: vi
      .fn<Connection["readSavedPost"]>()
      .mockResolvedValue(rows[0]),
    readDraft: vi.fn<Connection["readDraft"]>(async (place) => {
      if (options.draftRead) await options.draftRead;
      return drafts.get(draftKey(place)) ?? { message: "", revision: null };
    }),
    saveDraft: vi.fn<Connection["saveDraft"]>(async (place) => {
      const key = draftKey(place);
      const existing = drafts.get(key) ?? { message: "", revision: null };
      if (place.expectedRevision !== existing.revision)
        return { kind: "conflict", draft: existing };
      const draft = { message: place.message, revision: String(++revision) };
      drafts.set(key, draft);
      return { kind: "saved", draft };
    }),
    readJoinedTeams: vi.fn(async () => ({
      teams: [team],
      selectedTeam: team.id,
    })),
    submitDraft: vi.fn(),
    readPendingPosts: vi.fn<Connection["readPendingPosts"]>(async (where) =>
      options.pending &&
      where.channelId === options.pending.channelId &&
      (where.rootId ?? null) === options.pending.rootId
        ? [options.pending]
        : [],
    ),
    retireDeliveredPosts: vi.fn().mockResolvedValue(0),
    getOutgoingPostState: (post: PendingPost) =>
      outgoingRowState(post, false, true),
    subscribeToPostActivity: vi.fn(() => () => {}),
  };
  const viewer = options.viewer ?? userId;
  const coordination = options.coordination ?? createThreadReadCoordination();
  const workspace: TeamWorkspace = {
    bookmarkWrites: createChannelBookmarkWrites(),
    messages: {
      dialogOpen: false,
      open: vi.fn(),
      clear: vi.fn(),
      position: null,
      savedReturn: null,
      publishedReading: null,
      returnToSaved: vi.fn(),
      endSaved: vi.fn(),
      completeChannelChoice: vi.fn(),
      closeSavedSurface: vi.fn(),
      enqueue: (work) => work(),
    },
    connection: connection as unknown as Connection,
    threadReads: coordination.bind(
      "https://chat.example.test/team/chat",
      viewer,
      connection as unknown as Connection,
    ),
    serverUrl: "https://chat.example.test/team/chat",
    userId: viewer,
    team,
    online,
    directoryNotice: null,
    teamChoice: { teams: [], select: vi.fn() },
    sessionIssue: vi.fn(),
    exit: { cleanup: null, run: vi.fn() },
    policy: {
      server: {
        status: "ready",
        value: workspaceServerPolicy(
          {
            CollapsedThreads: collapsed ? "always_on" : "disabled",
            TeammateNameDisplay: options.directProfile
              ? "full_name"
              : undefined,
          },
          {},
        ),
      },
      user: sidebarPreferences(viewer, []),
      userReadFailed: false,
      reloadUser: vi.fn(),
      retry: vi.fn(),
    },
  };
  const content = <ChannelsWorkspace workspace={workspace} language="en" />;
  const view = render(
    options.eventSlot ? (
      <ChannelEventTargetContext.Provider
        value={{ active: options.eventSlot, retry: vi.fn() }}
      >
        {content}
      </ChannelEventTargetContext.Provider>
    ) : (
      content
    ),
  );
  return {
    ...connection,
    saved,
    writeSavedPost,
    unmount: view.unmount,
    closeConnection: workspace.threadReads.close,
    replaceRid(rid: number) {
      const next = { ...connection, rid } as unknown as Connection;
      view.rerender(
        <ChannelsWorkspace
          workspace={{
            ...workspace,
            connection: next,
            threadReads: coordination.bind(workspace.serverUrl, viewer, next),
          }}
          language="en"
        />,
      );
    },
    setPosition(
      position: Omit<
        NonNullable<TeamWorkspace["messages"]["position"]>,
        "sidebar"
      >,
    ) {
      view.rerender(
        <ChannelsWorkspace
          workspace={{
            ...workspace,
            messages: {
              ...workspace.messages,
              position: {
                ...position,
                sidebar: { selectedChannel: general, data },
              },
            },
          }}
          language="en"
        />,
      );
    },
    disableThreads() {
      view.rerender(
        <ChannelsWorkspace
          language="en"
          workspace={{
            ...workspace,
            policy: {
              ...workspace.policy,
              server: {
                status: "ready",
                value: workspaceServerPolicy(
                  { CollapsedThreads: "disabled" },
                  {},
                ),
              },
            },
          }}
        />,
      );
    },
    setDirectoryScope(scope: { rid?: number; teamId?: string }) {
      view.rerender(
        <ChannelsWorkspace
          workspace={{
            ...workspace,
            connection: {
              ...workspace.connection,
              rid: scope.rid ?? connection.rid,
            },
            team: { ...team, id: scope.teamId ?? team.id },
          }}
          language="en"
        />,
      );
    },
    setOnline(next: boolean) {
      view.rerender(
        <ChannelsWorkspace
          workspace={{ ...workspace, online: next }}
          language="en"
        />,
      );
    },
  };
}

test("keeps the Saved reminder while the return bar moves to the thread", async () => {
  const account = mount(true);
  await screen.findByText(root.message);
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const read = account.readChannelWindow.getMockImplementation();
  if (!read) throw Error("The channel window fixture is missing");
  account.readChannelWindow.mockImplementation(async (query) => {
    if (query.kind === "around") await gate;
    return read(query);
  });
  const position = {
    request: {
      kind: "focus" as const,
      requestId: 1,
      rid: account.rid,
      teamId: team.id,
      post: { ...reply, messageSource: null },
    },
    membership: "",
  };
  account.setPosition({
    ...position,
    saved: {
      teamId: "z".repeat(26),
      teamName: "Summer",
      channelId: null,
      index: 0,
      scroll: 0,
      reading: null,
    },
  });
  const back = { name: "Back to saved messages in team “Summer”" };
  const initial = await screen.findByRole("button", back);
  expect(initial.closest(".channels-conversation")).not.toBeNull();
  fireEvent.keyDown(window, {
    code: "KeyG",
    metaKey: usesMacOSOverlay,
    ctrlKey: !usesMacOSOverlay,
  });
  const copy = /The list is in team “Summer”/;
  const reminder = await screen.findByText(copy);
  await act(async () => resume());
  const thread = await screen.findByRole("complementary", { name: "Thread" });
  expect(within(thread).getByRole("button", back)).not.toBe(initial);
  expect(initial.isConnected).toBe(false);
  expect(screen.getByText(copy)).toBe(reminder);
  account.setPosition(position);
  expect(screen.queryByText(copy)).toBeNull();
});

test("choosing the current channel from the quick switcher closes its thread and keeps both drafts", async () => {
  mount(true);
  const main = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #General…",
  });
  fireEvent.change(main, { target: { value: "Channel draft" } });
  const thread = await screen.findByRole("button", {
    name: /Open thread, 1 reply/,
  });
  fireEvent.click(thread);
  const reply = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Reply in thread…",
  });
  fireEvent.change(reply, { target: { value: "Reply draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Find a channel" }));
  const dialog = within(
    await screen.findByRole("dialog", { name: "Find a channel" }),
  );
  fireEvent.change(dialog.getByRole("combobox"), {
    target: { value: "General" },
  });
  fireEvent.click(await dialog.findByRole("option", { name: "General" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("textbox", { name: "Reply in thread…" }),
    ).toBeNull(),
  );
  expect(main.value).toBe("Channel draft");
  fireEvent.click(thread);
  expect(
    (
      await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Reply in thread…",
      })
    ).value,
  ).toBe("Reply draft");
});

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
  expect(
    within(pane).getByRole("heading", {
      name: "Thread",
      description: "# General",
    }),
  ).toBeTruthy();
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

test("search results keep the underlying thread selected until the user returns to it", async () => {
  mount(true);
  fireEvent.click(
    await screen.findByRole("button", { name: /Open thread, 1 reply/ }),
  );
  const pane = await screen.findByRole("complementary", { name: "Thread" });
  expect(await within(pane).findByText(reply.message)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.change(dialog.getByRole("searchbox"), {
    target: { value: "fixture" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Search" }));
  const results = within(
    await screen.findByRole("complementary", { name: "Search results" }),
  );
  expect(await results.findByText("Found in search")).toBeTruthy();
  expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  const close = screen.queryByRole("button", { name: "Close search" });
  if (close) fireEvent.click(close);
  const restored = await screen.findByRole("complementary", { name: "Thread" });
  expect(await within(restored).findByText(reply.message)).toBeTruthy();
});

test("a search accepted from a reply clears only that draft when the results replace its editor", async () => {
  // Let React commit the results before the caller awaiting the search resumes.
  let finishSearch!: () => void;
  const accepted = new Promise<void>((resolve) => {
    finishSearch = resolve;
  });
  const useSearch = workspaceSearch.useWorkspaceSearch;
  const search = vi
    .spyOn(workspaceSearch, "useWorkspaceSearch")
    .mockImplementation((...args) => {
      const result = useSearch(...args);
      return {
        ...result,
        async fromCommand(...input) {
          const opened = await result.fromCommand(...input);
          await accepted;
          return opened;
        },
      };
    });
  try {
    const account = mount(true);
    const channel = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #General…",
    });
    fireEvent.change(channel, { target: { value: "Unsent in the channel" } });
    await waitFor(() =>
      expect(account.saveDraft).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Unsent in the channel" }),
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Open thread, 1 reply/ }),
    );
    const pane = await screen.findByRole("complementary", { name: "Thread" });
    const replyBox = await within(pane).findByRole("textbox", {
      name: "Reply in thread…",
    });
    fireEvent.change(replyBox, { target: { value: "/search fixture" } });
    fireEvent.click(within(pane).getByRole("button", { name: "Run command" }));
    const results = await screen.findByRole("complementary", {
      name: "Search results",
    });
    expect(await within(results).findByText("Found in search")).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
    await act(async () => {
      finishSearch();
    });
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    const restored = await screen.findByRole("complementary", {
      name: "Thread",
    });
    expect(
      (
        await within(restored).findByRole<HTMLTextAreaElement>("textbox", {
          name: "Reply in thread…",
        })
      ).value,
    ).toBe("");
    expect(channel.value).toBe("Unsent in the channel");
    expect(account.submitDraft).not.toHaveBeenCalled();
  } finally {
    finishSearch();
    search.mockRestore();
  }
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
  expect(
    await within(pane).findByRole("textbox", { name: "Reply in thread…" }),
  ).toBeTruthy();
  await act(async () =>
    reject(new ResponseError(new Response(null, { status: 403 }))),
  );
  expect(within(pane).getByRole("alert").textContent).toMatch(
    /no longer available/i,
  );
  expect(within(pane).queryByText(root.message)).toBeNull();
  expect(within(pane).queryByText(reply.message)).toBeNull();
  expect(within(pane).queryByRole("textbox")).toBeNull();
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
  const draft = await within(pane).findByRole<HTMLTextAreaElement>("textbox", {
    name: "Reply in thread…",
  });
  expect(document.activeElement).not.toBe(draft);
  fireEvent.change(draft, { target: { value: "Keep while offline" } });
  fireEvent.keyDown(draft, { key: "Enter" });
  expect(
    within(pane).getByRole<HTMLButtonElement>("button", {
      name: "Send message",
    }).disabled,
  ).toBe(true);
  expect(draft.value).toBe("Keep while offline");
  expect(connection.submitDraft).not.toHaveBeenCalled();
  connection.setOnline(true);
  await within(pane).findByText(reply.message);
  expect(
    (await within(pane).findByRole<HTMLTextAreaElement>("textbox")).value,
  ).toBe("Keep while offline");
  expect(connection.submitDraft).not.toHaveBeenCalled();
});

test("withdrawn posting permission unmounts the thread editor and keeps its draft for restored access", async () => {
  const connection = mount(true);
  fireEvent.click(
    await screen.findByRole("button", { name: /Open thread, 1 reply/ }),
  );
  const pane = await screen.findByRole("complementary", { name: "Thread" });
  const editor = await within(pane).findByRole("textbox");
  fireEvent.change(editor, {
    target: { value: "Keep through permission change" },
  });
  connection.readSavedTeamRoles.mockResolvedValue({
    systemRoles: "",
    definitions: [{ name: "writer", permissions: [] }],
  });
  connection.setOnline(false);
  await within(pane).findByText("This channel is read-only.");
  expect(within(pane).queryByRole("textbox")).toBeNull();
  connection.readSavedTeamRoles.mockResolvedValue({
    systemRoles: "",
    definitions: [{ name: "writer", permissions: ["create_post"] }],
  });
  connection.setOnline(true);
  const restored =
    await within(pane).findByRole<HTMLTextAreaElement>("textbox");
  expect(restored.value).toBe("Keep through permission change");
  expect(connection.submitDraft).not.toHaveBeenCalled();
});

test("a missing root keeps the reply editor closed and a later history limit overrides a local read", async () => {
  const connection = mount(false);
  let finishLocal!: (value: LocalPost | null) => void;
  connection.readSavedPost.mockReturnValue(
    new Promise((done) => {
      finishLocal = done;
    }),
  );
  let limit!: (result: {
    kind: "inaccessible";
    firstInaccessiblePostTime: number;
  }) => void;
  connection.readThreadPage.mockReturnValue(
    new Promise((done) => {
      limit = done;
    }),
  );
  const row = (await screen.findByText(reply.message)).closest("article");
  if (!row) throw new Error("Missing channel reply");
  fireEvent.click(within(row).getByRole("button", { name: "Open thread" }));
  const pane = await screen.findByRole("complementary", { name: "Thread" });
  await within(pane).findByText(reply.message);
  expect(within(pane).queryByRole("textbox")).toBeNull();
  await act(async () =>
    limit({ kind: "inaccessible", firstInaccessiblePostTime: 200 }),
  );
  expect(within(pane).getByRole("alert").textContent).toMatch(
    /available history/i,
  );
  await act(async () =>
    finishLocal({ ...root, rootId: null, messageSource: null }),
  );
  expect(within(pane).queryByRole("textbox")).toBeNull();
  expect(within(pane).queryByText(root.message)).toBeNull();
  expect(
    connection.readDraft.mock.calls.some(
      ([place]) => place.rootId !== undefined,
    ),
  ).toBe(false);
});

test("two thread drafts and the channel stay separate when the platform sends a reply to its root", async () => {
  const connection = mount(false, true, { second: true });
  connection.submitDraft.mockResolvedValue({
    kind: "sending",
    draft: { message: "", revision: "sent", clearedBySubmission: true },
    completion: Promise.resolve({ kind: "confirmed" }),
  });
  const channel = await screen.findByRole("main");
  async function open(message: string) {
    const article = (await within(channel).findByText(message)).closest(
      "article",
    );
    if (!article) throw new Error("Missing channel post");
    fireEvent.click(
      within(article).getByRole("button", { name: "Open thread" }),
    );
    const pane = await screen.findByRole("complementary", { name: "Thread" });
    return within(pane).findByRole<HTMLTextAreaElement>("textbox", {
      name: "Reply in thread…",
    });
  }
  const channelDraft = await within(channel).findByRole<HTMLTextAreaElement>(
    "textbox",
    { name: "Message #General…" },
  );
  fireEvent.change(channelDraft, { target: { value: "Channel draft" } });
  const first = await open(reply.message);
  const pane = screen.getByRole("complementary", { name: "Thread" });
  expect(document.activeElement).toBe(
    within(pane).getByText(reply.message).closest("article"),
  );
  fireEvent.change(first, { target: { value: "First reply" } });
  const second = await open(secondRoot.message);
  fireEvent.change(second, { target: { value: "Second reply" } });
  const reopened = await open(reply.message);
  expect(reopened.value).toBe("First reply");
  reopened.focus();
  const nativeEnter = fireEvent.keyDown(reopened, { key: "Enter" });
  if (["android", "ios"].includes(process.env.TAURI_ENV_PLATFORM ?? "")) {
    expect(nativeEnter).toBe(true);
    expect(connection.submitDraft).not.toHaveBeenCalled();
    const thread = screen.getByRole("complementary", { name: "Thread" });
    fireEvent.click(
      within(thread).getByRole("button", { name: "Send message" }),
    );
  } else {
    expect(nativeEnter).toBe(false);
  }
  await waitFor(() => expect(connection.submitDraft).toHaveBeenCalledOnce());
  expect(connection.submitDraft).toHaveBeenCalledWith({
    channelId: general,
    rootId: root.id,
    revision: expect.any(String),
  });
  await waitFor(() => expect(reopened.value).toBe(""));
  expect(document.activeElement).toBe(reopened);
  expect(channelDraft.value).toBe("Channel draft");
  expect((await open(secondRoot.message)).value).toBe("Second reply");
});

test.each([
  [{ writable: false }, "This channel is read-only."],
  [{ archived: true }, "You’re viewing an archived channel."],
] as const)(
  "shows the channel posting decision inside the open thread: %o",
  async (options, reason) => {
    const connection = mount(true, true, options);
    fireEvent.click(
      await screen.findByRole("button", { name: /Open thread, 1 reply/ }),
    );
    const pane = await screen.findByRole("complementary", { name: "Thread" });
    expect(await within(pane).findByText(reason)).toBeTruthy();
    expect(within(pane).queryByRole("textbox")).toBeNull();
    expect(connection.submitDraft).not.toHaveBeenCalled();
  },
);

test.each(["burn_on_read", "system_fake_parent_deleted"])(
  "never opens an editor on a restricted %s root",
  async (type) => {
    const connection = mount(true, true, { type });
    fireEvent.click(
      await screen.findByRole("button", { name: /Open thread, 1 reply/ }),
    );
    const pane = await screen.findByRole("complementary", { name: "Thread" });
    await within(pane).findByText(reply.message);
    expect(within(pane).queryByRole("textbox")).toBeNull();
    expect(
      connection.readDraft.mock.calls.some(
        ([place]) => place.rootId !== undefined,
      ),
    ).toBe(false);
  },
);

test.each([0, 86400000])(
  "a confirmed own reply across a gap of %i ms keeps its day, row and focus",
  async (dayOffset) => {
    const connection = mount(true);
    const author = channelProfile({
      id: userId,
      username: "ada",
      firstName: "Ada",
    });
    connection.readSavedProfiles.mockResolvedValue({
      profiles: { [userId]: author },
      usernames: { ada: userId },
    });
    connection.refreshSavedProfiles.mockImplementation(async ({ ids }) =>
      ids.includes(userId) ? [author] : [],
    );
    const canonical = {
      ...reply,
      id: "n".repeat(26),
      createAt: 400 + dayOffset,
      updateAt: 400 + dayOffset,
      message: "Own canonical reply",
    };
    const pending: PendingPost = {
      pendingId: "local-own-reply",
      channelId: general,
      rootId: root.id,
      sequence: 1,
      createdAt: 300 + dayOffset,
      previousLogin: false,
      attempt: 1,
      refusal: null,
      confirmedPostId: canonical.id,
      files: [],
      message: "Own local reply",
    };
    connection.readPendingPosts.mockImplementation(async ({ rootId }) =>
      rootId === root.id ? [pending] : [],
    );
    connection.readThreadPage
      .mockResolvedValueOnce({
        ...page,
        next: { id: reply.id, createAt: reply.createAt },
      })
      .mockResolvedValueOnce({ ...page, replies: [canonical] });
    fireEvent.click(
      await screen.findByRole("button", { name: /Open thread, 1 reply/ }),
    );
    const pane = await screen.findByRole("complementary", { name: "Thread" });
    const first = await within(pane).findByText(reply.message);
    const own = (await within(pane).findByText(pending.message)).closest(
      "article",
    );
    if (!own) throw new Error("Missing own outgoing row");
    expect(first.closest("article")?.hasAttribute("data-continuation")).toBe(
      false,
    );
    expect(own.hasAttribute("data-continuation")).toBe(false);
    expect(
      within(own).queryByRole("button", { name: "Message actions" }),
    ).toBeNull();
    const boundary = within(pane).getByRole("button", {
      name: /between these messages.*Show replies/,
    });
    expect(
      first.compareDocumentPosition(boundary) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      boundary.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const before = first.closest(".timeline-day-group");
    const after = own.closest(".timeline-day-group");
    expect(before).toBeTruthy();
    expect(boundary.closest(".timeline-day-group")).toBe(before);
    if (dayOffset === 0) expect(after).toBe(before);
    else {
      expect(after).not.toBe(before);
      const nextLabel = after?.querySelector("time");
      if (!nextLabel) throw Error("Missing date after the history gap");
      expect(
        boundary.compareDocumentPosition(nextLabel) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    own.focus();
    fireEvent.click(boundary);
    const confirmed = await within(pane).findByText(canonical.message);
    expect(confirmed.closest("article")).toBe(own);
    expect(document.activeElement).toBe(own);
    expect(own.dataset.postId).toBe(canonical.id);
    expect(own.dataset.localId).toBe(pending.pendingId);
    expect(own.hasAttribute("data-continuation")).toBe(dayOffset === 0);
    expect(within(pane).queryByText(pending.message)).toBeNull();
    expect(within(pane).queryByText(/between these messages/)).toBeNull();
    expect(connection.retireDeliveredPosts).toHaveBeenCalledWith([
      canonical.id,
    ]);
    expect(
      within(screen.getByRole("main")).queryByText(canonical.message),
    ).toBeNull();
    const write = fixtureClipboard();
    fireEvent.click(
      within(own).getByRole("button", { name: "Message actions" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await screen.findByText("Message link copied.");
    expect(write.mock.calls).toEqual([
      [`https://chat.example.test/team/chat/winter/pl/${canonical.id}`],
    ]);
  },
);

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

test("the workspace offers an explicit return after the last visible message is removed and preserves the channel draft", async () => {
  let releaseDraft!: () => void;
  const draftRead = new Promise<void>((resolve) => {
    releaseDraft = resolve;
  });
  const account = mount(true, true, { draftRead });
  await account.saveDraft({
    channelId: general,
    message: "Stored before opening",
    expectedRevision: null,
  });
  const open = await screen.findByRole("button", {
    name: /Open thread, 1 reply/,
  });
  const pane = screen.getByRole("region", { name: "Channel messages" });
  const row = open.closest("article");
  if (!row) throw Error("Missing message");
  Object.defineProperties(pane, {
    clientHeight: { value: 100 },
    scrollHeight: { value: 500 },
  });
  pane.scrollTop = 100;
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
  row.getBoundingClientRect = () => new DOMRect(0, -8, 100, 36);
  expect(screen.getByText("Opening draft…")).toBeTruthy();
  releaseDraft();
  const draft = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #General…",
  });
  expect(draft.value).toBe("Stored before opening");
  fireEvent.change(draft, { target: { value: "Keep my draft" } });
  draft.focus();
  const networkCalls = account.refreshChannelHistory.mock.calls.length;
  account.readChannelWindow.mockResolvedValueOnce(null);
  await act(async () => account.notifyChannelHistoryChanged(general));
  expect(
    await screen.findByText(
      "The messages you were reading are no longer available here.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Channel messages" })).toBeNull();
  expect(document.activeElement).toBe(draft);
  expect(draft.value).toBe("Keep my draft");
  expect(account.refreshChannelHistory).toHaveBeenCalledTimes(networkCalls);
  fireEvent.click(
    screen.getByRole("button", { name: "Go to latest messages" }),
  );
  expect(
    await screen.findByRole("button", { name: /Open thread, 1 reply/ }),
  ).toBeTruthy();
});

function handleEscape() {
  const target = document.activeElement;
  if (!target) throw Error("No focused control");
  const unhandled = fireEvent.keyDown(target, { key: "Escape" });
  // jsdom does not implement Escape's HTML dialog cancellation.
  const modal = target.closest<HTMLDialogElement>("dialog[open]");
  if (unhandled && modal)
    fireEvent(modal, new Event("cancel", { cancelable: true }));
}
async function enterSearch() {
  const trigger = screen.getByRole("button", { name: "Search" });
  fireEvent.click(trigger);
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.change(dialog.getByRole("searchbox"), {
    target: { value: "winter" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Search" }));
  return {
    trigger,
    panel: await screen.findByRole("complementary", { name: "Search results" }),
  };
}
test("one return at a time preserves search, thread and channel, including each draft", async () => {
  const { readSearchTimezone, unmount } = mount(true);
  const channelDraft = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #General…",
  });
  fireEvent.change(channelDraft, { target: { value: "Unsent channel text" } });
  const opener = await screen.findByRole("button", {
    name: /Open thread, 1 reply/,
  });
  fireEvent.click(opener);
  const before = await screen.findByRole("complementary", { name: "Thread" });
  const replyDraft = await within(before).findByRole("textbox", {
    name: "Reply in thread…",
  });
  fireEvent.change(replyDraft, { target: { value: "Unsent thread reply" } });
  const { trigger, panel } = await enterSearch();
  await within(panel).findByText("Found in search");
  const activeBack = androidBack;
  if (process.env.TAURI_ENV_PLATFORM === "android")
    expect(activeBack).toBeTypeOf("function");
  fireEvent.keyDown(trigger, { key: "Escape", isComposing: true });
  trigger.addEventListener("keydown", (event) => event.preventDefault(), {
    once: true,
  });
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(panel.isConnected).toBe(true);
  const step = () => (activeBack ? act(() => activeBack()) : handleEscape());
  fireEvent.click(within(panel).getByRole("button", { name: /Edit.*winter/i }));
  const form = within(await screen.findByRole("dialog"));
  fireEvent.change(form.getByRole("searchbox"), {
    target: { value: "unsubmitted" },
  });
  expect(androidBack).toBe(activeBack);
  step();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("complementary", { name: "Search results" })).toBe(
    panel,
  );
  expect(readSearchTimezone).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(trigger);
  step();
  const restored = await screen.findByRole("complementary", { name: "Thread" });
  expect(
    (
      await within(restored).findByRole<HTMLTextAreaElement>("textbox", {
        name: "Reply in thread…",
      })
    ).value,
  ).toBe("Unsent thread reply");
  expect(document.activeElement).toBe(trigger);
  step();
  expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(channelDraft.value).toBe("Unsent channel text");
  fireEvent.click(opener);
  expect(
    (
      await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Reply in thread…",
      })
    ).value,
  ).toBe("Unsent thread reply");
  unmount();
  if (activeBack) {
    mount(true);
    fireEvent.click(
      await screen.findByRole("button", { name: /Open thread, 1 reply/ }),
    );
    const next = await screen.findByRole("complementary", { name: "Thread" });
    act(() => activeBack());
    expect(next.isConnected).toBe(true);
    expect(androidBack).not.toBe(activeBack);
  }
});

test("canceling a pending search edit and the account dialog leaves the channel search results intact", async () => {
  const { readSearchTimezone } = mount(true);
  await screen.findByRole("textbox", { name: "Message #General…" });
  const { trigger, panel } = await enterSearch();
  const step = () =>
    androidBack ? act(() => androidBack?.()) : handleEscape();
  await within(panel).findByText("Found in search");
  fireEvent.click(screen.getByRole("button", { name: /account/i }));
  await screen.findByRole("dialog");
  step();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("complementary", { name: "Search results" })).toBe(
    panel,
  );
  fireEvent.click(within(panel).getByRole("button", { name: /Edit.*winter/i }));
  const form = within(await screen.findByRole("dialog"));
  let finish!: (tz: string) => void;
  readSearchTimezone.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.change(form.getByRole("searchbox"), {
    target: { value: "pending" },
  });
  fireEvent.click(form.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  step();
  await act(async () => finish("UTC"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(within(panel).getByText("winter")).toBeTruthy();
  step();
  expect(panel.isConnected).toBe(false);
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
});

test("the selected platform owns Back only while its thread is open", async () => {
  const listen = vi.mocked(onBackButtonPress);
  listen.mockClear();
  mount(true);
  const opener = await screen.findByRole("button", {
    name: /Open thread, 1 reply/,
  });
  expect(listen).not.toHaveBeenCalled();
  fireEvent.click(opener);
  const pane = await screen.findByRole("complementary", { name: "Thread" });

  if (process.env.TAURI_ENV_PLATFORM === "android") {
    expect(listen).toHaveBeenCalledOnce();
    const [press] = listen.mock.calls[0];
    const subscription = await listen.mock.results[0].value;
    await act(() => press({ canGoBack: false }));
    await waitFor(() => expect(subscription.unregister).toHaveBeenCalledOnce());

    // A queued event from the old listener must not affect the reopened thread.
    fireEvent.click(opener);
    const reopened = await screen.findByRole("complementary", {
      name: "Thread",
    });
    expect(listen).toHaveBeenCalledTimes(2);
    await act(() => press({ canGoBack: false }));
    expect(reopened.isConnected).toBe(true);
    fireEvent.click(
      within(reopened).getByRole("button", { name: "Close thread" }),
    );
  } else {
    expect(listen).not.toHaveBeenCalled();
    fireEvent.keyDown(pane, { key: "Escape" });
  }
  await waitFor(() =>
    expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull(),
  );
  expect(document.activeElement).toBe(opener);
});

test("a cold direct message keeps its initial empty until the profile is available", async () => {
  const account = mount(true, false, { direct: "D" });
  const sidebar = within(
    await screen.findByRole("region", { name: "Channel categories" }),
  );
  const cold = sidebar.getByRole("button", {
    name: "Direct message",
    current: "page",
  });
  const initial = cold.querySelector(".sidebar-conversation-row__initial");
  expect(initial?.textContent).toBe("");
  expect(account.refreshSavedProfiles).not.toHaveBeenCalled();

  const peer = "v".repeat(26);
  const profile = channelProfile({ id: peer, username: "vera" });
  account.readSavedProfiles.mockResolvedValue({
    profiles: { [peer]: profile },
    usernames: { vera: peer },
  });
  account.refreshSavedProfiles.mockImplementation(async ({ ids }) =>
    ids.includes(peer) ? [profile] : [],
  );
  account.setOnline(true);
  expect(
    await sidebar.findByRole("button", { name: "vera", current: "page" }),
  ).toBe(cold);
  expect(initial?.textContent).toBe("V");
});

test.each([
  ["alice", "Smith", "A"],
  ["🚀", "Smith", "🚀"],
  ["👩🏽‍💻", "Smith", "👩🏽‍💻"],
  ["🇪🇪", "Brown", "🇪🇪"],
  ["ßeta", "", "S"],
  ["e\u0301", "Smith", "E\u0301"],
])(
  "the sidebar shows one complete initial from %s %s",
  async (firstName, lastName, initial) => {
    mount(true, false, {
      direct: "D",
      directProfile: channelProfile({
        id: "v".repeat(26),
        username: "person",
        firstName,
        lastName,
      }),
    });
    const sidebar = within(
      await screen.findByRole("region", { name: "Channel categories" }),
    );
    const row = await sidebar.findByRole("button", {
      name: [firstName, lastName].filter(Boolean).join(" "),
      current: "page",
    });
    expect(
      row.querySelector(".sidebar-conversation-row__initial")?.textContent,
    ).toBe(initial);
  },
);

test("the directory opens from the sidebar, restores the draft on Back and selects the chosen membership", async () => {
  const account = mount(true);
  const draft = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #General…",
  });
  fireEvent.change(draft, { target: { value: "Keep my work" } });
  const trigger = screen.getByRole("button", { name: "Directory" });
  fireEvent.click(trigger);
  const directory = await screen.findByRole("main", { name: "Directory" });
  expect(
    within(directory).getByRole("region", { name: "My channels" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("textbox", { name: "Message #General…" }),
  ).toBeNull();
  expect(account.selectSidebarChannel).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(
    (
      await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Message #General…",
      })
    ).value,
  ).toBe("Keep my work");
  expect(account.selectSidebarChannel).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  const list = within(await screen.findByRole("list", { name: "My channels" }));
  fireEvent.click(list.getByRole("button", { name: /Design/ }));
  await screen.findByRole("main", { name: "Design" });
  expect(account.selectSidebarChannel).toHaveBeenCalledExactlyOnceWith(
    team.id,
    design,
  );
});

test("global search returns to the same directory filter before leaving the catalog", async () => {
  mount(true);
  const draft = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #General…",
  });
  fireEvent.change(draft, { target: { value: "My pending message" } });
  fireEvent.click(screen.getByRole("button", { name: "Directory" }));
  const field = await screen.findByRole<HTMLInputElement>("searchbox", {
    name: "Find a channel",
  });
  fireEvent.change(field, { target: { value: "Des" } });
  const search = screen.getByRole("button", { name: "Search" });
  fireEvent.click(search);
  const form = await screen.findByRole("dialog");
  fireEvent(form, new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("searchbox", { name: "Find a channel" })).toBe(field);
  const { panel } = await enterSearch();
  await within(panel).findByText("Found in search");
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(panel.isConnected).toBe(false));
  expect(screen.getByRole("searchbox", { name: "Find a channel" })).toBe(field);
  expect(field.value).toBe("Des");
  expect(
    screen.getByRole("button", { name: "Design, Public channel" }),
  ).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.getByRole("textbox", { name: "Message #General…" })).toBe(
    draft,
  );
  expect(draft.value).toBe("My pending message");
});

function fixtureClipboard() {
  const writeText = vi
    .fn<(text: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  vi.stubGlobal(
    "navigator",
    Object.create(navigator, { clipboard: { value: { writeText } } }),
  );
  return writeText;
}

const pendingCopyPost: PendingPost = {
  pendingId: "local-device-id",
  channelId: general,
  rootId: null,
  sequence: 1,
  createdAt: 300,
  previousLogin: true,
  attempt: 1,
  refusal: null,
  confirmedPostId: null,
  message: "Previous local attempt",
  files: [],
};

function holdClipboardRead() {
  let resolve!: (allowed: boolean) => void;
  vi.mocked(clipboardPolicy.readClipboardAllowed).mockReturnValueOnce(
    new Promise((complete) => {
      resolve = complete;
    }),
  );
  return resolve;
}

async function rowActions(
  label: string,
  container: HTMLElement = document.body,
) {
  const row = (await within(container).findByText(label)).closest("article");
  if (!row) throw Error("Missing published row");
  return within(row).getByRole("button", { name: "Message actions" });
}

async function savingMenu() {
  return within(await screen.findByRole("dialog", { name: "Message actions" }));
}

const knownAttachment = {
  id: "f".repeat(26),
  name: "draft_*_v2.txt",
};
const observedAttachments = {
  fileIds: [knownAttachment.id, "m".repeat(26)],
  files: [knownAttachment],
};

test.each([
  [
    "named and ID-only attachments",
    "",
    observedAttachments,
    "draft_*_v2.txt, Attachment 2",
  ],
  [
    "redacted attachments",
    "",
    { ...observedAttachments, redactedFileCount: 2 },
    null,
  ],
  ["an empty post", "", undefined, null],
  ["text before attachments", "**Comment**", observedAttachments, "Comment"],
] satisfies [string, string, LocalPost["attachments"], string | null][])(
  "uses the touch sheet excerpt for %s in the channel and the thread",
  async (_, message, attachments, expected) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("pointer: coarse"),
    }));
    const account = mount(true, true, { contents: { message, attachments } });
    const triggerName = /^Message actions ·/;
    async function checkExcerpt(trigger: HTMLElement) {
      fireEvent.click(trigger);
      const sheet = await screen.findByRole("dialog", {
        name: "Message actions",
      });
      const excerpt = sheet.querySelector(".post-actions-excerpt");
      expect(excerpt?.textContent ?? null).toBe(expected);
      fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    }
    await checkExcerpt(
      await screen.findByRole("button", { name: triggerName }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Open thread, 1 reply/ }),
    );
    const thread = await screen.findByRole("complementary", { name: "Thread" });
    const trigger = await waitFor(() => {
      const row = thread.querySelector<HTMLElement>(
        `article[data-post-id="${reply.id}"]`,
      );
      if (!row) throw Error("Missing thread reply");
      return within(row).getByRole("button", { name: triggerName });
    });
    await checkExcerpt(trigger);
    expect(account.readPostFiles).not.toHaveBeenCalled();
  },
);

function holdSave(account: ReturnType<typeof mount>) {
  let finish!: () => void;
  account.writeSavedPost.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  return finish;
}

test("the saved item keeps keyboard focus while the first account answer arrives", async () => {
  const account = mount(true, true, { savedReading: true });
  const opener = await rowActions(root.message);
  fireEvent.click(opener);
  const menu = await savingMenu();
  const button = menu.getByRole("button", { name: "Save" });
  button.focus();
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(menu.getByText("Loading saved messages…")).toBeTruthy();
  expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(false);
  act(() => {
    account.saved.finishRead(
      account.saved.beginRead(),
      new ResponseError(new Response(null, { status: 403 })),
    );
  });
  expect(
    menu.getByText("The server refused to load saved messages."),
  ).toBeTruthy();
  act(() => {
    account.saved.publish(account.saved.beginRead(), {
      ids: new Set([root.id]),
      upperBound: 1,
    });
  });
  expect(menu.getByRole("button", { name: "Remove from Saved" })).toBe(button);
  expect(button.hasAttribute("aria-disabled")).toBe(false);
  expect(document.activeElement).toBe(button);
  expect(menu.getByRole("status").textContent).toBe("Remove from Saved");
  expect(fireEvent.keyDown(button, { key: "Enter", repeat: true })).toBe(false);
  expect(account.writeSavedPost).not.toHaveBeenCalled();
});

test("holding Enter on Save leaves the restored menu opener idle until release", async () => {
  const account = mount(true);
  const settle = holdSave(account);
  const opener = await rowActions(root.message);
  fireEvent.click(opener);
  (await savingMenu()).getByRole("button", { name: "Save" }).focus();

  const keyboardState = await userEvent.keyboard("{Enter>3}");
  expect(document.activeElement).toBe(opener);
  expect(screen.queryByRole("dialog", { name: "Message actions" })).toBeNull();
  expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
  expect(account.writeSavedPost).toHaveBeenCalledExactlyOnceWith(root.id, true);

  await userEvent.keyboard("{/Enter}{Enter>2/}", { keyboardState });
  const menu = await savingMenu();
  expect(menu.getByRole("button", { name: "Saving…" })).toBeTruthy();
  expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
  await act(async () => settle());
  menu.getByRole("button", { name: "Remove from Saved" }).focus();
  await userEvent.keyboard("[Space]", { keyboardState });
  await screen.findByText("Removed from Saved.");
  expect(account.writeSavedPost).toHaveBeenCalledTimes(2);
  expect(account.writeSavedPost).toHaveBeenLastCalledWith(root.id, false);
});

test("saves a published reply with clipboard denied in a read-only thread, with one confirmed write", async () => {
  vi.mocked(clipboardPolicy.observeClipboardAllowed).mockImplementation(
    (report) => {
      report(false);
      return () => {};
    },
  );
  const account = mount(true, true, { writable: false });
  fireEvent.click(
    await screen.findByRole("button", { name: /Open thread, 1 reply/ }),
  );
  const thread = await screen.findByRole("complementary", { name: "Thread" });
  const opener = await rowActions(reply.message, thread);
  const wrote = holdSave(account);
  fireEvent.click(opener);
  let menu = await savingMenu();
  expect(menu.queryByRole("button", { name: "Copy link" })).toBeNull();
  fireEvent.click(menu.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(document.activeElement).toBe(opener));
  fireEvent.click(opener);
  menu = await savingMenu();
  const pending = menu.getByRole("button", { name: "Saving…" });
  expect(pending.getAttribute("aria-disabled")).toBe("true");
  expect(pending.getAttribute("aria-busy")).toBe("true");
  fireEvent.click(pending);
  await act(async () => wrote());
  expect(account.writeSavedPost).toHaveBeenCalledExactlyOnceWith(
    reply.id,
    true,
  );
  expect(account.getSavedPostState(root.id)).toBe(false);
  expect(menu.getByRole("button", { name: "Remove from Saved" })).toBe(pending);
  await screen.findByText("Saved. Only you can see your saved messages.");
});

test("a refusal keeps the saved state, an uncertain write waits for a read, and known offline does not send", async () => {
  const account = mount(true);
  const opener = await rowActions(root.message);
  account.writeSavedPost.mockRejectedValueOnce(
    new ResponseError(new Response(null, { status: 403 })),
  );
  fireEvent.click(opener);
  fireEvent.click((await savingMenu()).getByRole("button", { name: "Save" }));
  await screen.findByText(
    "Couldn’t save the message. The server refused the request.",
  );
  expect(account.getSavedPostState(root.id)).toBe(false);
  account.writeSavedPost.mockImplementationOnce(async () => {
    account.saved.record(root.id, undefined);
    throw Error("The response was lost.");
  });
  fireEvent.click(opener);
  fireEvent.click((await savingMenu()).getByRole("button", { name: "Save" }));
  await screen.findByText("Couldn’t confirm whether the message was saved.");
  fireEvent.click(opener);
  const menu = await savingMenu();
  expect(
    menu.getByText("Couldn’t confirm whether the message was saved."),
  ).toBeTruthy();
  expect(
    menu.getByRole("button", { name: "Save" }).getAttribute("aria-disabled"),
  ).toBe("true");
  account.setOnline(false);
  expect(
    menu.getByText("Couldn’t confirm whether the message was saved."),
  ).toBeTruthy();
  act(() =>
    account.saved.publish(account.saved.beginRead(), {
      ids: new Set([root.id]),
      upperBound: 1,
    }),
  );
  fireEvent.click(menu.getByRole("button", { name: "Remove from Saved" }));
  await screen.findByText("Couldn’t remove it from Saved. You’re offline.");
  expect(account.writeSavedPost).toHaveBeenCalledTimes(2);
  expect(account.getSavedPostState(root.id)).toBe(true);
});

test("a pending bookmark result belongs to its workspace after navigation and disappears with the old account", async () => {
  const original = mount(true);
  const draft = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #General…",
  });
  fireEvent.change(draft, { target: { value: "Keep my draft" } });
  const first = holdSave(original);
  fireEvent.click(await rowActions(root.message));
  fireEvent.click((await savingMenu()).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(original.writeSavedPost).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Design" }));
  await screen.findByRole("textbox", { name: "Message #Design…" });
  await act(async () => first());
  await screen.findByText("Saved. Only you can see your saved messages.");
  fireEvent.click(screen.getByRole("button", { name: "General" }));
  expect(
    (
      await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Message #General…",
      })
    ).value,
  ).toBe("Keep my draft");
  const second = holdSave(original);
  fireEvent.click(await rowActions(root.message));
  fireEvent.click(
    (await savingMenu()).getByRole("button", { name: "Remove from Saved" }),
  );
  await waitFor(() => expect(original.writeSavedPost).toHaveBeenCalledTimes(2));
  original.unmount();
  mount(true);
  await act(async () => second());
  expect(screen.queryByText("Removed from Saved.")).toBeNull();
});

test.each([
  [true, root.message, root.id],
  [false, reply.message, root.id],
])(
  "opens the selected channel row's root through its message menu",
  async (collapsed, message, rootId) => {
    const account = mount(collapsed);
    const draft = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #General…",
    });
    fireEvent.change(draft, { target: { value: "Keep this draft" } });
    const opener = await rowActions(message);
    const back = () =>
      androidBack ? act(() => androidBack?.()) : handleEscape();
    fireEvent.click(opener);
    back();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(account.readThreadPage).not.toHaveBeenCalled();

    fireEvent.click(opener);
    const menu = screen.getByRole("dialog", { name: "Message actions" });
    const open = within(menu).getByRole("button", { name: "Reply in thread" });
    expect(document.activeElement).toBe(open);
    act(() => {
      open.click();
      open.click();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    const pane = await screen.findByRole("complementary", { name: "Thread" });
    const displayedReply = await within(pane).findByText(reply.message);
    expect(document.activeElement).toBe(
      collapsed
        ? within(pane).getByRole("heading")
        : displayedReply.closest("article"),
    );
    expect(
      account.readThreadPage.mock.calls.map(([query]) => query.rootId),
    ).toEqual(collapsed ? [rootId] : [rootId, rootId]);

    fireEvent.click(await rowActions(reply.message, pane));
    const actions = within(
      screen.getByRole("dialog", { name: "Message actions" }),
    );
    expect(actions.getByRole("button", { name: "Save" })).toBe(
      document.activeElement,
    );
    expect(actions.queryByRole("button", { name: /thread/i })).toBeNull();
    back();
    expect(pane.isConnected).toBe(true);
    const restoreFocus = vi.spyOn(opener, "focus");
    back();
    expect(pane.isConnected).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(restoreFocus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(draft.value).toBe("Keep this draft");
  },
);

test("a read-only member can open a root with no replies through its message menu", async () => {
  const account = mount(true, true, { second: true, writable: false });
  await screen.findByText("This channel is read-only.");
  fireEvent.click(await rowActions(secondRoot.message));
  const menu = within(screen.getByRole("dialog", { name: "Message actions" }));
  expect(menu.queryByRole("button", { name: "Reply in thread" })).toBeNull();
  fireEvent.click(menu.getByRole("button", { name: "Open thread" }));
  const pane = within(
    await screen.findByRole("complementary", { name: "Thread" }),
  );
  expect(await pane.findByText(secondRoot.message)).toBeTruthy();
  expect(pane.queryByRole("textbox")).toBeNull();
  expect(pane.getByText("This channel is read-only.")).toBeTruthy();
  expect(account.readThreadPage).toHaveBeenCalledTimes(1);
  expect(account.readThreadPage.mock.calls[0]?.[0].rootId).toBe(secondRoot.id);
  expect(account.submitDraft).not.toHaveBeenCalled();
});

test("copies each published message's own permalink in Channels and in a thread, and returns keyboard focus", async () => {
  const write = fixtureClipboard();
  const account = mount(true);
  const draft = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #General…",
  });
  fireEvent.change(draft, { target: { value: "Keep this draft" } });
  const rootActions = await rowActions(root.message);
  fireEvent.click(rootActions);
  const menu = screen.getByRole("dialog", { name: "Message actions" });
  const copy = within(menu).getByRole("button", { name: "Copy link" });
  expect(document.activeElement).toBe(
    within(menu).getByRole("button", { name: "Reply in thread" }),
  );
  fireEvent.click(copy);
  await screen.findByText("Message link copied.");
  expect(write.mock.calls).toEqual([
    [`https://chat.example.test/team/chat/winter/pl/${root.id}`],
  ]);
  expect(document.activeElement).toBe(rootActions);
  fireEvent.click(screen.getByRole("button", { name: /Open thread, 1 reply/ }));
  const thread = await screen.findByRole("complementary", { name: "Thread" });
  const replyActions = await rowActions(reply.message, thread);
  fireEvent.click(replyActions);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(replyActions));
  write.mockRejectedValueOnce(Error("Clipboard denied"));
  fireEvent.click(replyActions);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await screen.findByText("Couldn’t copy the link.");
  expect(document.activeElement).toBe(replyActions);
  fireEvent.click(replyActions);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await screen.findByText("Message link copied.");
  expect(write.mock.calls.slice(1)).toEqual(
    Array(2).fill([
      `https://chat.example.test/team/chat/winter/pl/${reply.id}`,
    ]),
  );
  expect(account.selectSidebarChannel).not.toHaveBeenCalled();
  expect(draft.value).toBe("Keep this draft");
});

test("a removed published row closes its open action", async () => {
  const account = mount(true);
  const origin = await rowActions(root.message);
  const pane = screen.getByRole("region", { name: "Channel messages" });
  Object.defineProperty(pane, "clientHeight", { value: 100 });
  fireEvent.click(origin);
  expect(screen.getByRole("dialog", { name: "Message actions" })).toBeTruthy();
  account.readChannelWindow.mockResolvedValueOnce({
    posts: [],
    older: { kind: "end" },
    newer: { kind: "end" },
    firstInaccessiblePostTime: 0,
  });
  await act(async () => account.notifyChannelHistoryChanged(general));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(origin.isConnected).toBe(false);
  expect(screen.queryByRole("button", { name: "Message actions" })).toBeNull();
});

test.runIf(isAndroid)(
  "reads the device again for an explicit Android copy",
  async () => {
    const write = fixtureClipboard();
    vi.mocked(clipboardPolicy.readClipboardAllowed).mockResolvedValueOnce(
      false,
    );
    mount(true);
    fireEvent.click(await rowActions(root.message));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await screen.findByText("Couldn’t copy the link.");
    expect(write).not.toHaveBeenCalled();
  },
);

test.runIf(isAndroid)(
  "a late policy read cannot resume a copy from an earlier visit",
  async () => {
    const write = fixtureClipboard();
    const allow = holdClipboardRead();
    mount(true);
    const origin = await rowActions(root.message);
    fireEvent.click(origin);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    fireEvent.click(screen.getByRole("button", { name: "Reply in thread" }));
    const thread = await screen.findByRole("complementary", { name: "Thread" });
    fireEvent.click(
      within(thread).getByRole("button", { name: "Close thread" }),
    );
    expect(origin.isConnected).toBe(true);
    await act(async () => allow(true));
    expect(write).not.toHaveBeenCalled();
    expect(screen.queryByText("Message link copied.")).toBeNull();
  },
);

test.runIf(isAndroid).each([
  [
    "Copy link",
    "Message link copied.",
    `https://chat.example.test/team/chat/winter/pl/${root.id}`,
  ],
  ["Copy text", "Text copied.", pendingCopyPost.message],
])(
  "a batched revoke and grant invalidates the pending %s",
  async (action, success, value) => {
    let report!: (allowed: boolean) => void;
    vi.mocked(clipboardPolicy.observeClipboardAllowed).mockImplementation(
      (changed) => {
        report = changed;
        changed(true);
        return () => {};
      },
    );
    const write = fixtureClipboard();
    const allow = holdClipboardRead();
    mount(true, true, { pending: pendingCopyPost });
    const origin =
      action === "Copy link"
        ? await rowActions(root.message)
        : await screen.findByRole("button", { name: action });
    if (action === "Copy link") fireEvent.click(origin);
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(clipboardPolicy.readClipboardAllowed).toHaveBeenCalledTimes(1);
    act(() => {
      report(false);
      report(true);
    });
    expect(origin.isConnected).toBe(true);
    await act(async () => allow(true));
    expect(write).not.toHaveBeenCalled();
    expect(screen.queryByText(success)).toBeNull();
    const allowNext = holdClipboardRead();
    fireEvent.click(screen.getByRole("button", { name: action }));
    act(() => report(true));
    await act(async () => allowNext(true));
    await screen.findByText(success);
    expect(write).toHaveBeenCalledExactlyOnceWith(value);
  },
);

test.runIf(isAndroid)(
  "closing and reopening a message menu abandons its pending clipboard check",
  async () => {
    const write = fixtureClipboard();
    const allow = holdClipboardRead();
    mount(true);
    const origin = await rowActions(root.message);
    fireEvent.click(origin);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(clipboardPolicy.readClipboardAllowed).toHaveBeenCalledTimes(1);
    handleEscape();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(origin));
    fireEvent.click(origin);
    const action = screen.getByRole("button", { name: "Copy link" });
    await act(async () => allow(true));
    expect(write).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/Message link copied|Couldn’t copy the link/),
    ).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Reply in thread" }),
    );
    fireEvent.click(action);
    await screen.findByText("Message link copied.");
    expect(write).toHaveBeenCalledExactlyOnceWith(
      `https://chat.example.test/team/chat/winter/pl/${root.id}`,
    );
  },
);

test("closing a message menu after its write starts leaves the write and focus alone", async () => {
  const write = fixtureClipboard();
  let finish!: () => void;
  write.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mount(true);
  const origin = await rowActions(root.message);
  fireEvent.click(origin);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await waitFor(() =>
    expect(write).toHaveBeenCalledExactlyOnceWith(
      `https://chat.example.test/team/chat/winter/pl/${root.id}`,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  const draft = screen.getByRole("textbox", { name: "Message #General…" });
  draft.focus();
  await act(async () => finish());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Message link copied.")).toBeNull();
  expect(document.activeElement).toBe(draft);
  expect(write).toHaveBeenCalledTimes(1);
});

test.each([
  { archived: true, writable: false },
  { direct: "D" },
  { direct: "G" },
] as const)(
  "copies a saved row offline within the open team: %o",
  async (options) => {
    const write = fixtureClipboard();
    mount(true, false, options);
    fireEvent.click(await rowActions(root.message));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await screen.findByText("Message link copied.");
    expect(write).toHaveBeenCalledWith(
      `https://chat.example.test/team/chat/winter/pl/${root.id}`,
    );
  },
);

test.each([
  ["system_join_channel", userId, false],
  ["burn_on_read", "z".repeat(26), false],
  ["burn_on_read", userId, true],
])(
  "filters the published menu for %s and its author",
  async (type, rootAuthor, visible) => {
    mount(true, true, { type: String(type), rootAuthor: String(rootAuthor) });
    const row = (await screen.findByText(root.message)).closest("article");
    if (!row) throw Error("Missing message");
    const trigger = within(row).queryByRole("button", {
      name: "Message actions",
    });
    expect(Boolean(trigger)).toBe(visible);
    if (trigger) {
      fireEvent.click(trigger);
      const menu = within(
        screen.getByRole("dialog", { name: "Message actions" }),
      );
      expect(menu.getByRole("button", { name: "Copy link" })).toBeTruthy();
      expect(menu.queryByRole("button", { name: /thread/i })).toBeNull();
    }
  },
);

test("a device policy change hides both copy actions while the channel thread action stays usable", async () => {
  let change!: (allowed: boolean) => void;
  const policy = vi
    .spyOn(clipboardPolicy, "observeClipboardAllowed")
    .mockImplementation((report) => {
      change = report;
      report(true);
      return () => {};
    });
  const write = fixtureClipboard();
  try {
    mount(true, true, { pending: pendingCopyPost });
    await screen.findByRole("button", { name: "Copy text" });
    const pending = screen
      .getByText("Previous local attempt")
      .closest("article");
    if (!pending) throw Error("No pending row");
    expect(
      within(pending).queryByRole("button", { name: "Message actions" }),
    ).toBeNull();
    fireEvent.click(await rowActions(root.message));
    const menu = screen.getByRole("dialog", { name: "Message actions" });
    const actions = within(menu);
    actions.getByRole("button", { name: "Copy link" }).focus();
    act(() => change(false));
    expect(menu.isConnected).toBe(true);
    expect(actions.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy text" })).toBeNull();
    expect(write).not.toHaveBeenCalled();
    const open = actions.getByRole("button", { name: "Reply in thread" });
    expect(document.activeElement).toBe(open);
    fireEvent.click(open);
    const pane = await screen.findByRole("complementary", { name: "Thread" });
    expect(await within(pane).findByText(reply.message)).toBeTruthy();
    fireEvent.click(await rowActions(reply.message, pane));
    expect(
      (await savingMenu()).getByRole("button", { name: "Save" }),
    ).toBeTruthy();
    expect(clipboardPolicy.readClipboardAllowed).not.toHaveBeenCalled();
    act(() => change(true));
    expect(
      screen.getByRole("dialog", { name: "Message actions" }),
    ).toBeTruthy();
    act(() => change(false));
    expect(
      screen.getByRole("dialog", { name: "Message actions" }),
    ).toBeTruthy();
    handleEscape();
    handleEscape();
    act(() => change(true));
    expect(await rowActions(root.message)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    await screen.findByText("Text copied.");
    expect(write.mock.calls).toEqual([["Previous local attempt"]]);
  } finally {
    policy.mockRestore();
  }
});

function inboxRow(connection: ReturnType<typeof mount>, direct = false) {
  const source = {
    ...secondRoot,
    channelId: design,
    rootId: null,
    messageSource: null,
    message: "Review **this** build",
    userId: foreign,
  };
  const thread = {
    id: source.id,
    post: source,
    participantIds: [],
    replyCount: 2,
    lastReplyAt: 202,
    lastViewedAt: 200,
    unreadReplies: 1,
    unreadMentions: 0,
    isUrgent: false,
  };
  connection.readFollowedThreads.mockResolvedValue({
    items: [thread],
    nextBefore: null,
  });
  connection.readPostDestination.mockResolvedValue(
    direct
      ? {
          postId: source.id,
          channel: { id: design, displayName: "", kind: "D", joined: true },
          team: null,
        }
      : {
          postId: source.id,
          channel: {
            id: design,
            displayName: "Design",
            kind: "P",
            joined: true,
          },
          team: {
            id: team.id,
            displayName: team.displayName,
            kind: "O",
            joined: true,
          },
        },
  );
  connection.readPostAnchor.mockResolvedValue({
    postId: source.id,
    channelId: design,
    post: source,
    rootId: null,
  });
  return source;
}

function unreadInbox(account: ReturnType<typeof mount>, direct = false) {
  const source = inboxRow(account, direct);
  const fresh = {
    ...reply,
    channelId: design,
    userId: foreign,
    rootId: source.id,
    message: "Unread proof",
    createAt: 202,
    updateAt: 202,
  };
  account.readThreadPage.mockImplementation(async ({ direction }) => ({
    kind: "page",
    root: { ...source, rootId: "", messageSource: undefined },
    replies: direction === "down" ? [fresh] : [],
    next: null,
  }));
  return source;
}

test("an unconfirmed view can be checked explicitly without another write", async () => {
  const account = mount(true);
  const source = unreadInbox(account, true);
  let loseReceipt!: (error: unknown) => void;
  const receipt = new Promise<never>((_, reject) => {
    loseReceipt = reject;
  });
  account.markFollowedThreadRead.mockImplementation(
    (_team, _id, _timestamp, _signal, onNativeSend) => {
      onNativeSend?.();
      return receipt;
    },
  );
  fireEvent.click(await screen.findByRole("button", { name: /^Threads/ }));
  async function openRow() {
    const row = await screen.findByRole("button", {
      name: /Review this build/,
    });
    row.focus();
    fireEvent.click(row);
    const pane = await screen.findByRole("complementary", { name: "Thread" });
    await within(pane).findByRole("separator", { name: "Unread replies" });
    return pane;
  }
  const pane = await openRow();
  await waitFor(() =>
    expect(account.markFollowedThreadRead).toHaveBeenCalledOnce(),
  );
  await act(async () => loseReceipt(new TypeError("Lost response")));
  const check = await within(pane).findByRole("button", {
    name: "Check read status",
  });
  await within(pane).findByText("Couldn’t confirm the read status");
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  account.setOnline(false);
  account.setOnline(true);
  expect(account.markFollowedThreadRead).toHaveBeenCalledOnce();
  expect(account.readFollowedThreadState).not.toHaveBeenCalled();
  expect(check.isConnected).toBe(true);

  handleEscape();
  expect(pane.isConnected).toBe(false);
  const reopened = await openRow();
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(account.markFollowedThreadRead).toHaveBeenCalledOnce();
  expect(account.readFollowedThreadState).not.toHaveBeenCalled();
  expect(account.readThreadPage).toHaveBeenCalledTimes(3);
  expect(account.readThreadPage.mock.lastCall?.[0]).toMatchObject({
    direction: "down",
    cursor: { id: reply.id, createAt: 202 },
  });

  const button = await within(reopened).findByRole("button", {
    name: "Check read status",
  });
  const draft = await within(reopened).findByRole<HTMLTextAreaElement>(
    "textbox",
    { name: "Reply in thread…" },
  );
  fireEvent.change(draft, { target: { value: "Draft stays" } });
  const event = userEvent.setup();
  const first = deferred<never>();
  const countsAtCheck = account.readFollowedThreadTotals.mock.calls.length;
  const listAtCheck = account.readFollowedThreads.mock.calls.length;
  account.readFollowedThreadState.mockImplementationOnce(
    async () => first.promise,
  );
  button.focus();
  await event.keyboard("{Enter}");
  await within(reopened).findByText("Checking read status…");
  expect(button.getAttribute("aria-busy")).toBe("true");
  fireEvent.click(button);
  expect(account.readFollowedThreadState.mock.calls).toEqual([
    [
      { teamId: team.id, channelId: design, rootId: source.id },
      expect.any(AbortSignal),
    ],
  ]);
  // A 404 can mean the followed membership disappeared while the post is still readable.
  await act(async () =>
    first.reject(
      new ResponseError(
        new Response(null, { status: 404 }),
        "Missing membership",
      ),
    ),
  );
  await within(reopened).findByText("Couldn’t confirm the read status");
  expect(button.getAttribute("aria-busy")).toBe("false");
  expect(document.activeElement).toBe(button);
  expect(
    within(reopened).getByRole("separator", { name: "Unread replies" }),
  ).toBeTruthy();
  expect(account.readFollowedThreadTotals).toHaveBeenCalledTimes(countsAtCheck);
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(listAtCheck);

  const observed = {
    id: source.id,
    lastViewedAt: 220,
    unreadReplies: 0,
    unreadMentions: 0,
    following: true as const,
  };
  const listed = (await account.readFollowedThreads.mock.results[0].value)
    .items[0];
  account.readFollowedThreads.mockResolvedValue({
    items: [{ ...listed, ...observed }],
    nextBefore: null,
  });
  account.readFollowedThreadTotals.mockResolvedValue({
    total: 1,
    totalUnreadThreads: 0,
    totalUnreadMentions: 0,
    totalUnreadUrgentMentions: 0,
  });
  account.readFollowedThreadState.mockResolvedValue(observed);
  await event.keyboard("{Enter}");
  await within(reopened).findByText("Checked: the thread isn’t marked unread");
  expect(
    within(reopened).queryByRole("separator", { name: "Unread replies" }),
  ).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(draft.value).toBe("Draft stays");
  expect(account.readFollowedThreadTotals).toHaveBeenCalledTimes(
    countsAtCheck + 1,
  );
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(listAtCheck);

  await event.keyboard("{Enter}");
  await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("false"));
  expect(account.readFollowedThreadState).toHaveBeenCalledTimes(3);
  expect(account.readFollowedThreadTotals).toHaveBeenCalledTimes(
    countsAtCheck + 1,
  );
  expect(account.readFollowedThreads).toHaveBeenCalledTimes(listAtCheck);
  handleEscape();
  fireEvent.click(
    await screen.findByRole("button", { name: /Review this build/ }),
  );
  const openedRead = await screen.findByRole("complementary", {
    name: "Thread",
  });
  await within(openedRead).findByText(
    "Checked: the thread isn’t marked unread",
  );
  expect(account.markFollowedThreadRead).toHaveBeenCalledOnce();
  expect(account.readFollowedThreadState).toHaveBeenCalledTimes(3);

  account.readFollowedThreadState.mockRejectedValueOnce(
    new ResponseError(new Response(null, { status: 403 }), "Forbidden"),
  );
  const revoked = within(openedRead).getByRole("button", {
    name: "Check read status",
  });
  revoked.focus();
  await event.keyboard("{Enter}");
  await within(openedRead).findByText(
    "You don’t have access to this discussion",
  );
  expect(within(openedRead).queryByRole("textbox")).toBeNull();
  expect(within(openedRead).queryByText("Unread proof")).toBeNull();
  expect(document.activeElement).toBe(
    within(openedRead).getByRole("heading", { name: "Thread" }),
  );
  expect(account.readFollowedThreadState).toHaveBeenCalledTimes(4);
  expect(account.markFollowedThreadRead).toHaveBeenCalledOnce();
});

test("shows the cold root and returns to retained replies while the inbox revalidates", async () => {
  const account = mount(true);
  const first = inboxRow(account);
  const second = {
    ...first,
    id: "y".repeat(26),
    message: "Second inbox discussion",
  };
  const fixture = (
    await account.readFollowedThreads({ teamId: team.id, unread: false })
  ).items[0];
  account.readFollowedThreads.mockClear();
  account.readFollowedThreads.mockResolvedValue({
    items: [first, second].map((post) => ({
      ...fixture,
      id: post.id,
      post,
      unreadReplies: 0,
    })),
    nextBefore: null,
  });
  const access = deferred<void>();
  const warm = deferred<void>();
  const revoked = deferred<void>();
  const newest = deferred<void>();
  const byId = new Map([
    [first.id, first],
    [second.id, second],
  ]);
  const destination = await account.readPostDestination(first.id);
  account.readPostDestination.mockClear();
  let selectFirst = 0;
  account.readPostDestination.mockImplementation(async (id) => {
    if (id === first.id) {
      selectFirst++;
      if (selectFirst === 1) await access.promise;
      if (selectFirst === 2) await warm.promise;
      if (selectFirst === 3) {
        await revoked.promise;
        throw new ResponseError(new Response(null, { status: 403 }), "Revoked");
      }
    }
    return { ...destination, postId: id };
  });
  account.readPostAnchor.mockImplementation(async (id) => {
    const post = byId.get(id);
    if (!post) throw Error("Unknown fixture post");
    return { postId: id, channelId: design, rootId: null, post };
  });
  const originalA = {
    ...reply,
    id: "k".repeat(26),
    rootId: first.id,
    channelId: design,
    message: "Original cached answer",
    userId: foreign,
  };
  const deletedA = {
    ...originalA,
    id: "j".repeat(26),
    message: "Reply awaiting deletion",
    createAt: originalA.createAt - 1,
    updateAt: originalA.updateAt - 1,
  };
  const unobservedA = {
    ...deletedA,
    id: "i".repeat(26),
    message: "Reply outside the partial update",
    createAt: deletedA.createAt - 1,
    updateAt: deletedA.updateAt - 1,
  };
  const freshA = {
    ...originalA,
    id: "l".repeat(26),
    message: "Late additional answer",
    createAt: 222,
    updateAt: 222,
  };
  account.readThreadPage.mockImplementation(async (query) => {
    const post = byId.get(query.rootId);
    if (!post) throw Error("Unknown fixture root");
    if (query.cursor && query.rootId === first.id) await newest.promise;
    const replies =
      query.rootId === first.id
        ? query.cursor
          ? [freshA]
          : [unobservedA, deletedA, originalA]
        : [
            {
              ...originalA,
              id: "q".repeat(26),
              rootId: second.id,
              message: "Answer from second discussion",
            },
          ];
    return {
      kind: "page",
      root: { ...post, rootId: "", messageSource: undefined },
      replies,
      next: null,
    };
  });
  fireEvent.click(await screen.findByRole("button", { name: /^Threads/ }));
  const select = async (pattern: RegExp) => {
    await userEvent.click(await screen.findByRole("button", { name: pattern }));
    return within(await screen.findByRole("complementary", { name: "Thread" }));
  };
  let pane = await select(/Review this build/);
  expect(await pane.findByText(/Review/)).toBeTruthy();
  const loading = await pane.findByText("Loading replies…");
  expect(loading.classList.contains("panel-text--secondary")).toBe(true);
  expect(account.readThreadPage).not.toHaveBeenCalled();
  await act(async () => access.resolve());
  await pane.findByText("Original cached answer");
  const editor = await pane.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Reply in thread…",
  });
  fireEvent.change(editor, { target: { value: "Keep this thread draft" } });
  await waitFor(() => expect(account.saveDraft).toHaveBeenCalled());
  pane = await select(/Second inbox discussion/);
  await pane.findByText("Answer from second discussion");
  const editedA = {
    ...originalA,
    updateAt: originalA.updateAt + 1,
    message: "Confirmed edit while parked",
  };
  act(() =>
    account.notifyChannelHistoryChanged(design, undefined, [
      channelPostChange(design, editedA.id, editedA),
      channelPostChange(design, deletedA.id, { ...deletedA, deleteAt: 221 }),
    ]),
  );
  act(() =>
    account.notifyChannelHistoryChanged(design, undefined, [
      channelPostChange(design, originalA.id, originalA),
      channelPostChange(design, deletedA.id, deletedA),
    ]),
  );

  pane = await select(/Review this build/);
  const originalLine = await pane.findByText("Confirmed edit while parked");
  expect(pane.queryByText("Original cached answer")).toBeNull();
  expect(pane.queryByText("Reply awaiting deletion")).toBeNull();
  expect(pane.getByText("Reply outside the partial update")).toBeTruthy();
  expect(pane.queryByText("Loading replies…")).toBeNull();
  expect(account.readThreadPage).toHaveBeenCalledTimes(2);
  await act(async () => warm.resolve());
  await waitFor(() => expect(account.readThreadPage).toHaveBeenCalledTimes(3));
  expect(account.readThreadPage.mock.lastCall?.[0]).toMatchObject({
    direction: "down",
    cursor: { id: originalA.id, createAt: originalA.createAt },
  });
  await pane.findByText("Updating…", {}, { timeout: 1800 });
  await act(async () => newest.resolve());
  expect(await pane.findByText("Late additional answer")).toBeTruthy();
  expect(originalLine.isConnected).toBe(true);
  expect(pane.queryByText("Updating…")).toBeNull();
  expect(
    (
      await pane.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Reply in thread…",
      })
    ).value,
  ).toBe("Keep this thread draft");
  pane = await select(/Second inbox discussion/);
  await pane.findByText("Answer from second discussion");
  pane = await select(/Review this build/);
  await pane.findByText("Late additional answer");
  await userEvent.click(
    await pane.findByRole("textbox", { name: "Reply in thread…" }),
  );
  await act(async () => revoked.resolve());
  await pane.findByText("You don’t have access to this discussion");
  expect(pane.queryByText("Confirmed edit while parked")).toBeNull();
  expect(pane.queryByText("Reply outside the partial update")).toBeNull();
  expect(pane.queryByText("Late additional answer")).toBeNull();
  expect(pane.queryByRole("textbox")).toBeNull();
  expect(document.activeElement).toBe(
    pane.getByRole("heading", { name: "Thread" }),
  );
  expect(
    account.readThreadPage.mock.calls.filter(
      ([query]) => query.rootId === first.id,
    ),
  ).toHaveLength(2);
  expect(account.markFollowedThreadRead).not.toHaveBeenCalled();
});

test("a replacement RID opens cold and discards the old window's late reply", async () => {
  const account = mount(true);
  const source = unreadInbox(account);
  const prior = {
    ...reply,
    id: "z".repeat(26),
    message: "Only on the closed RID",
    rootId: source.id,
    channelId: design,
    userId: foreign,
    createAt: 204,
    updateAt: 204,
  };
  const newest = {
    ...prior,
    id: "y".repeat(26),
    message: "Only on the new RID",
    createAt: 206,
    updateAt: 206,
  };
  const delayed = deferred<void>();
  const cold = deferred<void>();
  let replacement = false;
  let oldSignal: AbortSignal | undefined;
  account.readThreadPage.mockImplementation(async (query, signal) => {
    if (query.cursor) {
      oldSignal = signal;
      await delayed.promise;
    } else if (replacement) await cold.promise;
    return {
      kind: "page",
      root: { ...source, rootId: "", messageSource: undefined },
      replies: query.direction === "down" ? [replacement ? newest : prior] : [],
      next: null,
    };
  });
  const list = async () =>
    fireEvent.click(await screen.findByRole("button", { name: /^Threads/ }));
  const open = async () => {
    fireEvent.click(
      await screen.findByRole("button", { name: /Review this build/ }),
    );
    return within(await screen.findByRole("complementary", { name: "Thread" }));
  };
  await list();
  let pane = await open();
  await pane.findByText("Only on the closed RID");
  handleEscape();
  pane = await open();
  await pane.findByText("Only on the closed RID");
  await waitFor(() => expect(oldSignal).toBeDefined());
  replacement = true;
  account.replaceRid(2);
  expect(oldSignal?.aborted).toBe(true);
  await list();
  pane = await open();
  await pane.findByText("Loading replies…");
  expect(pane.queryByText("Only on the closed RID")).toBeNull();
  await act(async () => delayed.resolve());
  expect(pane.queryByText("Only on the new RID")).toBeNull();
  await act(async () => cold.resolve());
  await pane.findByText("Only on the new RID");
});

test("an automatic mark that failed before dispatch can be retried from the pane", async () => {
  const account = mount(true);
  const source = unreadInbox(account);
  const sent = vi.fn();
  account.markFollowedThreadRead.mockRejectedValueOnce(
    new TypeError("Offline before dispatch"),
  );
  account.markFollowedThreadRead.mockImplementation(
    async (_team, _root, lastViewedAt, _signal, onSend) => {
      onSend?.();
      sent();
      return {
        id: source.id,
        lastViewedAt,
        unreadReplies: 0,
        unreadMentions: 0,
      };
    },
  );
  fireEvent.click(await screen.findByRole("button", { name: /^Threads/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Review this build/ }),
  );
  const pane = within(
    await screen.findByRole("complementary", { name: "Thread" }),
  );
  const retry = await pane.findByRole("button", { name: "Try again" });
  expect(sent).not.toHaveBeenCalled();
  retry.focus();
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(retry.isConnected).toBe(false));
  expect(document.activeElement).toBe(
    pane.getByRole("heading", { name: "Thread" }),
  );
  expect(sent).toHaveBeenCalledOnce();
  expect(account.readFollowedThreadState).not.toHaveBeenCalled();
  expect(pane.getByRole("separator", { name: "Unread replies" })).toBeTruthy();
});

test("switching accounts while a check is pending discards its observation and refresh", async () => {
  const coordination = createThreadReadCoordination();
  const old = mount(true, true, { coordination });
  const source = unreadInbox(old);
  old.markFollowedThreadRead.mockImplementation(
    async (_team, _root, _time, _signal, onSend) => {
      onSend?.();
      throw new TypeError("Lost confirmation");
    },
  );
  const result =
    deferred<Awaited<ReturnType<Connection["readFollowedThreadState"]>>>();
  old.readFollowedThreadState.mockReturnValueOnce(result.promise);
  fireEvent.click(await screen.findByRole("button", { name: /^Threads/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Review this build/ }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Check read status" }),
  );
  await screen.findByText("Checking read status…");
  const counts = old.readFollowedThreadTotals.mock.calls.length;
  const signal = old.readFollowedThreadState.mock.lastCall?.[1];
  act(old.closeConnection);
  old.unmount();
  const next = mount(true, true, { coordination, viewer: "v".repeat(26) });
  unreadInbox(next);
  await act(async () =>
    result.resolve({
      id: source.id,
      lastViewedAt: 220,
      unreadReplies: 0,
      unreadMentions: 0,
      following: true,
    }),
  );
  await screen.findByText(root.message);
  expect(signal?.aborted).toBe(true);
  expect(old.readFollowedThreadTotals).toHaveBeenCalledTimes(counts);
  expect(old.markFollowedThreadRead).toHaveBeenCalledOnce();
  expect(next.readFollowedThreadState).not.toHaveBeenCalled();
  expect(next.markFollowedThreadRead).not.toHaveBeenCalled();
  expect(screen.queryByText(/Checked: the thread/)).toBeNull();
});

test.each([false, true])(
  "opens a followed thread with its own channel permissions and preserves both drafts (direct conversation %s)",
  async (direct) => {
    const connection = mount(true, true, { directDesign: direct });
    const channelDraft = await screen.findByRole<HTMLTextAreaElement>(
      "textbox",
      { name: "Message #General…" },
    );
    fireEvent.change(channelDraft, {
      target: { value: "Original channel draft" },
    });
    const source = inboxRow(connection, direct);
    const fresh = {
      ...reply,
      channelId: design,
      userId: foreign,
      rootId: source.id,
      message: "Fresh reply",
      createAt: 202,
      updateAt: 202,
    };
    connection.readThreadPage.mockImplementation(async ({ direction }) => ({
      kind: "page",
      root: { ...source, rootId: "", messageSource: undefined },
      replies: direction === "down" ? [fresh] : [],
      next: null,
    }));
    let confirm!: () => void;
    connection.markFollowedThreadRead.mockImplementation(
      (_team, _root, ts) =>
        new Promise((resolve) => {
          confirm = () =>
            resolve({
              id: source.id,
              lastViewedAt: ts,
              unreadReplies: 0,
              unreadMentions: 0,
            });
        }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Threads/ }));
    const unread = await screen.findByRole("tab", { name: /Unread/ });
    fireEvent.click(unread);
    const row = await screen.findByRole("button", {
      name: /Review this build/,
    });
    row.focus();
    fireEvent.click(row);
    const pane = await screen.findByRole("complementary", { name: "Thread" });
    expect(
      await within(pane).findByRole("separator", { name: "Unread replies" }),
    ).toBeTruthy();
    expect(within(pane).getByText("Fresh reply")).toBeTruthy();
    expect(
      connection.readThreadPage.mock.calls.map(([q]) => [
        q.direction,
        q.fromCreateAt,
      ]),
    ).toEqual([
      ["up", 201],
      ["down", 200],
    ]);
    expect(connection.markFollowedThreadRead).toHaveBeenCalledTimes(1);
    expect(row.textContent).toContain("1 new reply");
    const draft = await within(pane).findByRole<HTMLTextAreaElement>(
      "textbox",
      {
        name: "Reply in thread…",
      },
    );
    fireEvent.change(draft, { target: { value: "Design reply draft" } });
    await waitFor(() =>
      expect(
        connection.saveDraft.mock.calls.some(
          ([saved]) =>
            saved.channelId === design &&
            saved.rootId === source.id &&
            saved.message === "Design reply draft",
        ),
      ).toBe(true),
    );
    await act(async () => confirm());
    await waitFor(() => expect(row.textContent).not.toContain("1 new reply"));
    expect(
      within(pane).getByRole("separator", { name: "Unread replies" }),
    ).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Thread" }),
      ).toBeNull(),
    );
    expect(
      screen.queryByRole("button", { name: /Review this build/ }),
    ).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(unread));
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(screen.getByRole("textbox", { name: "Message #General…" })).toBe(
      channelDraft,
    );
    expect(channelDraft.value).toBe("Original channel draft");
  },
);

test("hides global threads when collapsed threads are disabled and never reads their counters", async () => {
  const connection = mount(false);
  await screen.findAllByRole("button", { name: /Open thread/ });
  expect(screen.queryByRole("button", { name: /^Threads/ })).toBeNull();
  expect(connection.readFollowedThreadTotals).not.toHaveBeenCalled();
});

test("removes a revoked root from both thread lists while keeping Back available", async () => {
  const connection = mount(true);
  inboxRow(connection);
  connection.readPostDestination.mockRejectedValue(
    new ResponseError(new Response(null, { status: 404 })),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Threads/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Review this build/ }),
  );
  expect(
    await screen.findByText("This discussion is no longer available."),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /Review this build/ }),
  ).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull(),
  );
  fireEvent.click(screen.getByRole("tab", { name: /Unread/ }));
  await screen.findByText("No available discussions on this page.");
  expect(connection.readPostAnchor).not.toHaveBeenCalled();
  expect(connection.markFollowedThreadRead).not.toHaveBeenCalled();
});

test("waits for both sides of the unread window and clears the cached excerpt on a denied reply page", async () => {
  const connection = mount(true);
  const source = inboxRow(connection);
  let reject!: (error: Error) => void;
  connection.readThreadPage.mockImplementation(async ({ direction }) =>
    direction === "up"
      ? {
          kind: "page",
          root: { ...source, rootId: "", messageSource: undefined },
          replies: [],
          next: null,
        }
      : await new Promise((_resolve, fail) => {
          reject = fail;
        }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Threads/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Review this build/ }),
  );
  await waitFor(() =>
    expect(connection.readThreadPage).toHaveBeenCalledTimes(2),
  );
  expect(connection.markFollowedThreadRead).not.toHaveBeenCalled();
  await act(async () =>
    reject(new ResponseError(new Response(null, { status: 403 }))),
  );
  await screen.findByText("This discussion is no longer available.");
  expect(
    screen.queryByRole("button", { name: /Review this build/ }),
  ).toBeNull();
  expect(connection.markFollowedThreadRead).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("textbox", { name: "Reply in thread…" }),
  ).toBeNull();
});

test("withdraws the open preview when a newer tab reports a null root", async () => {
  const connection = mount(true);
  const source = inboxRow(connection);
  connection.readFollowedThreads.mockImplementation(async ({ unread }) => ({
    items: [
      {
        id: source.id,
        post: unread ? null : source,
        participantIds: [],
        replyCount: 1,
        lastReplyAt: 220,
        lastViewedAt: 220,
        unreadReplies: 0,
        unreadMentions: 0,
        isUrgent: false,
      },
    ],
    nextBefore: null,
  }));
  connection.readThreadPage.mockResolvedValue({
    kind: "page",
    root: { ...source, rootId: "", messageSource: undefined },
    replies: [],
    next: null,
  });
  fireEvent.click(await screen.findByRole("button", { name: /^Threads/ }));
  const row = await screen.findByRole("button", { name: /Review this build/ });
  fireEvent.click(row);
  const pane = await screen.findByRole("complementary", { name: "Thread" });
  await within(pane).findByRole("textbox", { name: "Reply in thread…" });
  fireEvent.click(screen.getByRole("tab", { name: /Unread/ }));
  await screen.findByText("No available discussions on this page.");
  expect(
    screen.queryByRole("button", { name: /Review this build/ }),
  ).toBeNull();
  expect(within(pane).queryByRole("article")).toBeNull();
  expect(
    within(pane).queryByRole("textbox", { name: "Reply in thread…" }),
  ).toBeNull();
});

test("one inbox controller serves repeated entry and revisits to both ready tabs", async () => {
  const connection = mount(true);
  inboxRow(connection);
  const trigger = await screen.findByRole("button", { name: /^Threads/ });
  fireEvent.click(trigger);
  await screen.findByRole("button", { name: /Review this build/ });
  fireEvent.click(trigger);
  const tabs = screen.getAllByRole("tab");
  expect(tabs).toHaveLength(2);
  for (const tab of [tabs[1], tabs[0], tabs[1]]) {
    fireEvent.click(tab);
    await screen.findByRole("button", { name: /Review this build/ });
  }
  expect(
    connection.readFollowedThreads.mock.calls.map(([q]) => q.unread),
  ).toEqual([false, true]);
  expect(connection.readFollowedThreadTotals).toHaveBeenCalledTimes(1);
  expect(connection.readPostAnchor).not.toHaveBeenCalled();
  expect(connection.readThreadPage).not.toHaveBeenCalled();
});

test.each([0, 1])(
  "keeps confirmed mention counts across a failed refresh (urgent %i)",
  async (urgent) => {
    const account = mount(true);
    const counts = {
      total: 4,
      totalUnreadThreads: 2,
      totalUnreadMentions: 3,
      totalUnreadUrgentMentions: urgent,
    };
    const retry = deferred<typeof counts>();
    account.readFollowedThreadTotals
      .mockResolvedValueOnce(counts)
      .mockRejectedValueOnce(
        new ResponseError(new Response(null, { status: 503 })),
      )
      .mockReturnValueOnce(retry.promise);
    const name =
      "Threads, unread discussions: 2, mentions: 3" +
      (urgent ? ", urgent: 1" : "");
    const trigger = await screen.findByRole("button", { name });
    const badge = trigger.querySelector(".workspace-count");
    expect(badge?.textContent).toBe(urgent ? "!3" : "3");
    fireEvent.click(trigger);
    await screen.findByText("No followed threads yet.");
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(account.readFollowedThreadTotals).toHaveBeenCalledTimes(1);
    fireEvent.click(trigger);
    const button = await screen.findByRole("button", {
      name: "Retry loading counts",
    });
    expect(
      screen.getByText(
        "Counts could not be updated. The server rejected the request.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name })).toBe(trigger);
    button.focus();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() =>
      expect(account.readFollowedThreadTotals).toHaveBeenCalledTimes(3),
    );
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(trigger.contains(badge)).toBe(true);
    await act(async () =>
      retry.resolve({
        ...counts,
        totalUnreadMentions: 0,
        totalUnreadUrgentMentions: 0,
      }),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("tab", { name: "Followed threads" }),
      ),
    );
    expect(trigger.querySelector(".workspace-count")).toBeNull();
    expect(trigger.querySelector(".workspace-unread")).toBeTruthy();
    account.readFollowedThreadTotals.mockResolvedValueOnce({
      ...counts,
      totalUnreadThreads: 0,
      totalUnreadMentions: 0,
      totalUnreadUrgentMentions: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(trigger.getAttribute("aria-label")).toBe("Threads"),
    );
    expect(trigger.querySelector(".workspace-unread")).toBeNull();
  },
);

test("a late anchor cannot reopen an editor after another tab has revoked its root", async () => {
  const account = mount(true);
  const source = inboxRow(account);
  const anchor = deferred<Awaited<ReturnType<Connection["readPostAnchor"]>>>();
  account.readPostAnchor.mockReturnValueOnce(anchor.promise);
  fireEvent.click(await screen.findByRole("button", { name: /^Threads/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Review this build/ }),
  );
  await waitFor(() => expect(account.readPostAnchor).toHaveBeenCalledTimes(1));
  account.readFollowedThreads.mockResolvedValueOnce({
    items: [
      {
        id: source.id,
        post: null,
        participantIds: [],
        replyCount: 1,
        lastReplyAt: 250,
        lastViewedAt: 0,
        unreadReplies: 1,
        unreadMentions: 0,
        isUrgent: false,
      },
    ],
    nextBefore: null,
  });
  fireEvent.click(screen.getByRole("tab", { name: /Unread/ }));
  await screen.findByText("This discussion is no longer available.");
  await act(async () =>
    anchor.resolve({
      postId: source.id,
      channelId: design,
      post: source,
      rootId: null,
    }),
  );
  expect(
    screen.queryByRole("textbox", { name: "Reply in thread…" }),
  ).toBeNull();
  expect(account.readThreadPage).not.toHaveBeenCalled();
  expect(account.markFollowedThreadRead).not.toHaveBeenCalled();
});

test("a followed thread loaded behind the search dialog stays unread until the reader returns", async () => {
  const connection = mount(true);
  const source = inboxRow(connection);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  connection.readThreadPage.mockImplementation(async ({ direction }) => {
    if (direction === "down") await pending;
    return {
      kind: "page",
      root: { ...source, rootId: "", messageSource: undefined },
      replies:
        direction === "down"
          ? [
              {
                ...reply,
                channelId: design,
                userId: foreign,
                rootId: source.id,
                message: "Reply behind search",
                createAt: 202,
                updateAt: 202,
              },
            ]
          : [],
      next: null,
    };
  });
  connection.markFollowedThreadRead.mockImplementation(
    async (_team, id, ts) => ({
      id,
      lastViewedAt: ts,
      unreadReplies: 0,
      unreadMentions: 0,
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Threads/ }));
  const opener = await screen.findByRole("button", {
    name: /Review this build/,
  });
  opener.focus();
  fireEvent.click(opener);
  await waitFor(() =>
    expect(connection.readThreadPage).toHaveBeenCalledTimes(2),
  );
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  const search = await screen.findByRole("dialog");
  await within(search).findByRole("searchbox");
  await act(async () => {
    release();
  });
  await screen.findByText("Reply behind search");
  expect(connection.markFollowedThreadRead).not.toHaveBeenCalled();
  handleEscape();
  await waitFor(() => {
    expect(search.isConnected).toBe(false);
    expect(connection.markFollowedThreadRead).toHaveBeenCalledTimes(1);
  });
});

test("disabling collapsed threads while a root is opening retires the inbox and preserves flat thread navigation", async () => {
  const account = mount(true);
  const source = inboxRow(account);
  const anchor = deferred<Awaited<ReturnType<Connection["readPostAnchor"]>>>();
  account.readPostAnchor.mockReturnValueOnce(anchor.promise);
  fireEvent.click(await screen.findByRole("button", { name: /^Threads/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Review this build/ }),
  );
  await waitFor(() => expect(account.readPostAnchor).toHaveBeenCalledTimes(1));
  account.disableThreads();
  await act(async () =>
    anchor.resolve({
      postId: source.id,
      channelId: design,
      post: source,
      rootId: null,
    }),
  );
  expect(screen.queryByRole("tab", { name: "Followed threads" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Threads/ })).toBeNull();
  expect(account.readThreadPage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "General" }));
  fireEvent.click(
    (await screen.findAllByRole("button", { name: /Open thread/ }))[0],
  );
  await screen.findByRole("complementary", { name: "Thread" });
  expect(account.readFollowedThreadTotals).toHaveBeenCalledTimes(1);
});

test("a rejected view keeps its unread row and retries the same discussion when the window regains focus", async () => {
  const account = mount(true);
  const source = inboxRow(account);
  account.readThreadPage.mockResolvedValue({
    kind: "page",
    root: { ...source, rootId: "", messageSource: undefined },
    replies: [],
    next: null,
  });
  account.markFollowedThreadRead
    .mockRejectedValueOnce(Error("request failed"))
    .mockImplementationOnce(async (_team, id, lastViewedAt) => ({
      id,
      lastViewedAt,
      unreadMentions: 0,
      unreadReplies: 0,
    }));
  fireEvent.click(await screen.findByRole("button", { name: /^Threads/ }));
  const row = await screen.findByRole("button", { name: /Review this build/ });
  row.focus();
  fireEvent.click(row);
  await screen.findByText("Couldn’t mark this discussion as read.");
  expect(row.getAttribute("data-unread")).toBe("true");
  expect(account.readFollowedThreadTotals).toHaveBeenCalledTimes(1);
  fireEvent.focus(window);
  await waitFor(() => expect(row.hasAttribute("data-unread")).toBe(false));
  expect(account.markFollowedThreadRead).toHaveBeenCalledTimes(2);
  expect(account.readFollowedThreadTotals).toHaveBeenCalledTimes(2);
});

test.each([
  ["accepted", true],
  ["accepted", false],
  ["refused", false],
] as const)(
  "a sent reply rereads follow only on confirmation (%s, server follow %s)",
  async (outcome, followsAfterReply) => {
    const connection = mount(true);
    const delivery = deferred<
      | { kind: "accepted"; post: typeof reply; matched: boolean }
      | {
          kind: "refused";
          refusal: { status: number; code: string; message: null };
        }
    >();
    connection.submitDraft.mockResolvedValue({
      kind: "sending",
      draft: { message: "", revision: "sent", clearedBySubmission: true },
      completion: delivery.promise,
    });
    connection.readThreadPage
      .mockResolvedValueOnce({
        ...page,
        root: { ...root, isFollowing: false },
      })
      .mockResolvedValueOnce({
        ...page,
        root: { ...root, isFollowing: followsAfterReply },
      });
    fireEvent.click(
      await screen.findByRole("button", { name: /Open thread, 1 reply/ }),
    );
    const pane = within(
      await screen.findByRole("complementary", { name: "Thread" }),
    );
    await pane.findByRole("button", { name: "Follow", pressed: false });
    const draft = await pane.findByRole("textbox", {
      name: "Reply in thread…",
    });
    fireEvent.change(draft, { target: { value: "My own answer" } });
    fireEvent.click(pane.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(connection.submitDraft).toHaveBeenCalledOnce());
    expect(connection.readThreadPage).toHaveBeenCalledTimes(1);
    await act(async () => {
      delivery.resolve(
        outcome === "accepted"
          ? { kind: "accepted", post: reply, matched: true }
          : {
              kind: "refused",
              refusal: { status: 403, code: "send.denied", message: null },
            },
      );
    });
    expect(connection.setThreadFollowing).not.toHaveBeenCalled();
    expect(connection.readThreadPage).toHaveBeenCalledTimes(
      outcome === "accepted" ? 2 : 1,
    );
    if (outcome === "accepted")
      expect(connection.readThreadPage).toHaveBeenLastCalledWith(
        {
          channelId: general,
          rootId: root.id,
          collapsedThreads: true,
          direction: "down",
          perPage: 1,
        },
        expect.any(AbortSignal),
      );
    expect(
      pane.getByRole("button", {
        name: followsAfterReply ? "Following" : "Follow",
        pressed: followsAfterReply,
      }),
    ).toBeTruthy();
  },
);

test("a readable direct conversation can follow a root with no replies", async () => {
  const connection = mount(true, true, {
    direct: "D",
    writable: false,
    second: true,
  });
  connection.readThreadPage
    .mockResolvedValueOnce({
      ...page,
      root: { ...secondRoot, isFollowing: false },
      replies: [],
    })
    .mockResolvedValueOnce({
      ...page,
      root: { ...secondRoot, isFollowing: true },
      replies: [],
    });
  const opener = await rowActions(secondRoot.message);
  async function open() {
    fireEvent.click(opener);
    const menu = await savingMenu();
    fireEvent.click(menu.getByRole("button", { name: "Open thread" }));
    return within(await screen.findByRole("complementary", { name: "Thread" }));
  }
  let pane = await open();
  expect(await pane.findByText("No replies yet.")).toBeTruthy();
  expect(pane.queryByRole("textbox")).toBeNull();
  const button = await pane.findByRole("button", {
    name: "Follow",
    pressed: false,
  });
  button.focus();
  await userEvent.keyboard("{Enter}");
  expect(
    await pane.findByRole("button", { name: "Following", pressed: true }),
  ).toBe(button);
  expect(document.activeElement).toBe(button);
  expect(connection.setThreadFollowing).toHaveBeenCalledExactlyOnceWith(
    team.id,
    { id: secondRoot.id, rootId: null },
    true,
    expect.any(AbortSignal),
  );
  fireEvent.click(pane.getByRole("button", { name: "Close thread" }));
  pane = await open();
  expect(
    await pane.findByRole("button", { name: "Following", pressed: true }),
  ).toBeTruthy();
  expect(connection.setThreadFollowing).toHaveBeenCalledOnce();
});

import { createThreadReadCoordination } from "../mattermost/thread-read-coordination.ts";

test.each(["list_team_channels", "join_public_channels"])(
  "the catalogue alone does not grant writes or public discovery with %s",
  async (permission) => {
    const account = mount(true, true, { directoryPermissions: [permission] });
    await screen.findByText(root.message);
    fireEvent.click(screen.getByRole("button", { name: "Directory" }));
    await screen.findByRole("searchbox", { name: "Find a channel" });
    expect(screen.queryByRole("tab", { name: "Available" })).toBeNull();
    expect(account.readChannelDirectoryPage).not.toHaveBeenCalled();
    expect(account.searchChannelDirectory).not.toHaveBeenCalled();
    expect(account.changeOwnMembership).not.toHaveBeenCalled();
  },
);

test("switching thread mode cannot expose channel history after a known refusal", async () => {
  const account = mount(true);
  const refresh =
    deferred<Awaited<ReturnType<Connection["refreshChannelHistory"]>>>();
  account.refreshChannelHistory
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 403 })),
    )
    .mockReturnValueOnce(refresh.promise);
  await screen.findByRole("heading", {
    name: "This content is no longer available to your account.",
  });
  account.readChannelWindow.mockClear();
  account.disableThreads();
  await waitFor(() =>
    expect(account.refreshChannelHistory).toHaveBeenCalledTimes(2),
  );
  expect(account.refreshChannelHistory.mock.lastCall?.[0]).toMatchObject({
    collapsedThreads: false,
  });
  expect(account.readChannelWindow).not.toHaveBeenCalled();
  expect(screen.queryByText(root.message)).toBeNull();
  await act(async () => refresh.resolve({ kind: "applied" }));
  await screen.findByText(root.message);
  expect(account.readChannelWindow.mock.lastCall?.[0]).toMatchObject({
    collapsedThreads: false,
  });
});

test("a second warm return keeps the confirmed timeline while refresh is still pending", async () => {
  const account = mount(true);
  const retaining =
    deferred<Awaited<ReturnType<Connection["refreshChannelHistory"]>>>();
  const local =
    deferred<Awaited<ReturnType<Connection["readChannelWindow"]>>>();
  const firstFrame = async () => {
    await screen.findByText(root.message);
    const pane = screen.getByRole("region", { name: "Channel messages" });
    Object.defineProperty(pane, "clientHeight", { value: 120 });
  };
  const pick = (name: string) =>
    fireEvent.click(screen.getByRole("button", { name }));

  await firstFrame();
  await waitFor(() =>
    expect(account.readChannelWindow).toHaveBeenCalledTimes(2),
  );
  const read = account.readChannelWindow.getMockImplementation();
  if (!read) throw Error("The initial history reader is required.");
  pick("Design");
  await screen.findByRole("heading", { name: "Design" });
  await waitFor(() =>
    expect(account.readChannelWindow).toHaveBeenCalledTimes(4),
  );
  account.refreshChannelHistory.mockImplementation(({ channelId }) =>
    channelId === general
      ? retaining.promise
      : Promise.resolve({ kind: "applied" }),
  );
  account.readChannelWindow.mockImplementation((input) =>
    input.channelId === general ? local.promise : read(input),
  );
  pick("General");
  await firstFrame();
  pick("Design");
  await screen.findByRole("heading", { name: "Design" });
  pick("General");
  await screen.findByRole("heading", { name: "General" });
  expect(screen.getByText(root.message)).toBeTruthy();
  expect(
    account.readChannelWindow.mock.calls.filter(
      ([input]) => input.channelId === general,
    ),
  ).toHaveLength(2);
  expect(
    account.refreshChannelHistory.mock.calls.filter(
      ([input]) => input.channelId === general,
    ),
  ).toHaveLength(3);
});

test.each([
  "directory",
  "sidebar",
  "other channel",
  "team picker Back before acknowledgement",
  "search Back before acknowledgement",
])(
  "a delayed local selection preserves newer navigation and focus from %s",
  async (source) => {
    const account = mount(true);
    await screen.findByText(root.message);
    await waitFor(() =>
      expect(account.readChannelWindow).toHaveBeenCalledTimes(2),
    );
    const pane = screen.getByRole("region", { name: "Channel messages" });
    Object.defineProperty(pane, "clientHeight", { value: 120 });
    const draft = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #General…",
    });
    const panes = draft.closest(".channels-panes");
    if (!panes) throw Error("Missing workspace panes");
    const text = "Draft stays with the current channel";
    fireEvent.change(draft, { target: { value: text } });
    const switchingChannel = source !== "directory" && source !== "sidebar";
    const backFirst = source.endsWith("before acknowledgement");
    const search = source.startsWith("search");
    if (switchingChannel) {
      fireEvent.click(screen.getByRole("button", { name: "Design" }));
      await screen.findByRole("heading", { name: "Design" });
      await waitFor(() =>
        expect(account.readChannelWindow).toHaveBeenCalledTimes(4),
      );
    }
    const navigate = () =>
      fireEvent.click(screen.getByRole("button", { name: "Channels" }));
    navigate();
    const selected = deferred<boolean>();
    account.selectSidebarChannel.mockReturnValueOnce(selected.promise);
    const readCount = account.readChannelWindow.mock.calls.length;
    if (source === "directory") {
      fireEvent.click(screen.getByRole("button", { name: "Directory" }));
      await screen.findByRole("heading", { name: "Directory" });
      fireEvent.click(
        screen.getByRole("button", { name: "General, Public channel" }),
      );
    } else fireEvent.click(screen.getByRole("button", { name: "General" }));
    await waitFor(() =>
      expect(account.selectSidebarChannel).toHaveBeenLastCalledWith(
        team.id,
        general,
      ),
    );
    if (!search && panes.getAttribute("data-page") === "conversation")
      navigate();
    const opener = screen.getByRole("button", {
      name: search ? "Search" : /^Switch team,/,
    });
    const dialog = {
      name: search ? "What are you looking for?" : "Teams and servers",
    };
    fireEvent.click(opener);
    await screen.findByRole("dialog", dialog);
    async function back() {
      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("dialog", dialog)).toBeNull(),
      );
      expect(document.activeElement).toBe(opener);
    }
    if (backFirst) await back();
    await act(async () => selected.resolve(true));
    expect(panes.getAttribute("data-page")).toBe(
      search ? "conversation" : "navigation",
    );
    if (!backFirst) await back();
    expect(document.activeElement).toBe(opener);
    if (!switchingChannel) {
      expect(draft.isConnected).toBe(true);
      expect(draft.value).toBe(text);
      expect(pane.isConnected).toBe(true);
      expect(account.readChannelWindow).toHaveBeenCalledTimes(readCount);
    }
  },
);

test.each([{ rid: 2 }, { teamId: "n".repeat(26) }])(
  "a new directory scope starts fresh and ignores an old pending answer (%o)",
  async (scope) => {
    const account = mount(true, true, {
      directoryPermissions: ["list_team_channels", "join_public_channels"],
    });
    const old =
      deferred<Awaited<ReturnType<Connection["readChannelDirectoryPage"]>>>();
    account.readChannelDirectoryPage.mockImplementationOnce(() => old.promise);
    await screen.findByText(root.message);
    const trigger = screen.getByRole("button", { name: "Directory" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("tab", { name: "Available" }));
    await waitFor(() =>
      expect(account.readChannelDirectoryPage).toHaveBeenCalledTimes(1),
    );
    account.setDirectoryScope(scope);
    await waitFor(() =>
      expect(
        screen
          .getByRole("tab", { name: "My channels" })
          .getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(account.readChannelDirectoryPage.mock.calls[0][1]?.aborted).toBe(
      true,
    );
    fireEvent.click(await screen.findByRole("tab", { name: "Available" }));
    await screen.findByText("No available channels");
    expect(account.readChannelDirectoryPage.mock.lastCall?.[0].teamId).toBe(
      scope.teamId ?? team.id,
    );
    await act(async () =>
      old.resolve({
        hasMore: false,
        items: [
          {
            id: "a".repeat(26),
            kind: "O",
            name: "former",
            displayName: "Former scope",
            purpose: "",
            deleteAt: 0,
          },
        ],
      }),
    );
    expect(screen.queryByText("Former scope")).toBeNull();
    expect(screen.getByText("No available channels")).toBeTruthy();
    expect(account.changeOwnMembership).not.toHaveBeenCalled();
  },
);
test("a denied live channel read removes the open messages and the thread composer from the current workspace", async () => {
  const slot: { current: OpenEventTarget | null } = { current: null };
  const account = mount(true, true, { eventSlot: slot });
  fireEvent.click(
    await screen.findByRole("button", { name: /Open thread, 1 reply/ }),
  );
  await screen.findByRole("textbox", { name: "Reply in thread…" });
  account.refreshChannelHistory.mockRejectedValueOnce(
    new ResponseError(new Response(null, { status: 403 })),
  );
  const target = slot.current;
  if (!target) throw Error("No current channel event consumer");
  await act(async () =>
    target.apply(
      {
        kind: "posts",
        changes: [
          {
            kind: "created",
            channelId: general,
            postId: "j".repeat(26),
            rootId: null,
          },
        ],
      },
      new AbortController().signal,
    ),
  );
  expect(
    await screen.findByRole("heading", {
      name: "This content is no longer available to your account.",
    }),
  ).toBeTruthy();
  expect(screen.queryByText(root.message)).toBeNull();
  expect(
    screen.queryByRole("textbox", { name: "Reply in thread…" }),
  ).toBeNull();
  expect(target.signal.aborted).toBe(true);
});

function liveWorkspace(collapsed = true, second = false) {
  const slot: { current: OpenEventTarget | null } = { current: null };
  const account = mount(collapsed, true, { eventSlot: slot, second });
  const target = () => {
    if (!slot.current) throw Error("No current channel event consumer");
    return slot.current;
  };
  return {
    account,
    target,
    async deliver(
      ...changes: Extract<
        Parameters<OpenEventTarget["apply"]>[0],
        { kind: "posts" }
      >["changes"]
    ) {
      const current = target();
      await act(async () =>
        current.apply({ kind: "posts", changes }, current.signal),
      );
    },
    async openThread() {
      const row = (await screen.findByText(root.message)).closest("article");
      if (!row) throw Error("Missing original channel row");
      fireEvent.click(within(row).getByRole("button", { name: /Open thread/ }));
      const pane = await screen.findByRole("complementary", { name: "Thread" });
      await within(pane).findByRole("textbox", { name: "Reply in thread…" });
      return pane;
    },
  };
}
const liveReply = {
  kind: "created" as const,
  channelId: general,
  postId: "j".repeat(26),
  rootId: root.id,
};
const liveRoot = { ...liveReply, rootId: null };

test("a refused focused CRT refresh clears the channel after a signed channel refusal", async () => {
  const { account, openThread, deliver } = liveWorkspace();
  await openThread();
  account.refreshChannelHistory.mockClear();
  account.refreshChannelHistory.mockRejectedValue(
    new ResponseError(new Response(null, { status: 403 })),
  );
  await deliver(liveReply);
  expect(account.refreshChannelHistory.mock.calls.map(([q]) => q.kind)).toEqual(
    ["focused", "latest"],
  );
  expect(screen.queryByText(root.message)).toBeNull();
  expect(
    screen.queryByRole("textbox", { name: "Reply in thread…" }),
  ).toBeNull();
  expect(
    screen.queryByRole("textbox", { name: "Message #General…" }),
  ).toBeNull();
});

test("the sole focused CRT root can disappear while the channel stays accessible", async () => {
  const { account, openThread, deliver } = liveWorkspace();
  const pane = await openThread();
  const missing = new ResponseError(new Response(null, { status: 404 }));
  account.refreshChannelHistory.mockClear();
  account.refreshChannelHistory
    .mockRejectedValueOnce(missing)
    .mockResolvedValueOnce({ kind: "applied" });
  account.readThreadPage.mockRejectedValue(missing);
  await deliver(liveReply);
  expect(
    await within(pane).findByText("This thread is no longer available."),
  ).toBeTruthy();
  expect(screen.queryByText(root.message)).toBeNull();
  expect(
    screen.getByRole("textbox", { name: "Message #General…" }),
  ).toBeTruthy();
  expect(account.applyChannelPostEvents).not.toHaveBeenCalled();
});

test.each(["inaccessible", "applied"] as const)(
  "a live %s cutoff hides cached rows while an accessible message still arrives",
  async (kind) => {
    const { account, openThread, deliver } = liveWorkspace();
    const threadPane = await openThread();
    const pane = document.querySelector<HTMLElement>(
      ".channels-conversation .timeline-scroll",
    );
    if (!pane) throw Error("Missing timeline viewport");
    Object.defineProperty(pane, "clientHeight", { value: 120 });
    account.refreshChannelHistory.mockClear();
    account.refreshChannelHistory.mockResolvedValueOnce({
      kind,
      firstInaccessiblePostTime: root.createAt,
    });
    await deliver(liveReply);
    expect(screen.queryByText(root.message)).toBeNull();
    expect(within(threadPane).queryByRole("textbox")).toBeNull();
    expect(within(threadPane).getByRole("alert").textContent).toMatch(
      /available history/i,
    );

    const allowed = {
      ...root,
      id: liveRoot.postId,
      rootId: null,
      createAt: 300,
      updateAt: 300,
      message: "New accessible message",
      messageSource: null,
    };
    account.refreshChannelHistory.mockImplementationOnce(async (_, active) => {
      account.readChannelWindow.mockResolvedValue({
        posts: [allowed, { ...root, messageSource: null, rootId: null }],
        older: { kind: "end" },
        newer: { kind: "end" },
        firstInaccessiblePostTime: 0,
      });
      account.notifyChannelHistoryChanged(general, active);
      return { kind: "applied" };
    });
    await deliver(liveRoot);
    expect(await screen.findByText(allowed.message)).toBeTruthy();
    expect(screen.queryByText(root.message)).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Message #General…" }),
    ).toBeTruthy();
  },
);

test("changing the open root inside one channel cancels the previous focused event read", async () => {
  const live = liveWorkspace(true, true);
  await live.openThread();
  const first = live.target();
  const response = deferred<{ kind: "applied" }>();
  live.account.refreshChannelHistory.mockReturnValueOnce(response.promise);
  const receiving = first.apply(
    { kind: "posts", changes: [liveReply] },
    first.signal,
  );
  const done = expect(receiving).rejects.toMatchObject({ name: "AbortError" });
  await waitFor(() =>
    expect(live.account.refreshChannelHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "focused", postId: root.id }),
      first.signal,
    ),
  );
  const other = (await screen.findByText(secondRoot.message)).closest(
    "article",
  );
  if (!other) throw Error("Missing second root");
  fireEvent.click(within(other).getByRole("button", { name: "Open thread" }));
  await waitFor(() => expect(first.signal.aborted).toBe(true));
  expect(live.target()).not.toBe(first);
  await act(async () => response.resolve({ kind: "applied" }));
  await done;
  expect(
    within(screen.getByRole("complementary", { name: "Thread" })).queryByText(
      root.message,
    ),
  ).toBeNull();
});
