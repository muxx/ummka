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
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { isAndroid } from "../build-platform.ts";
import * as clipboardPolicy from "../device/clipboard-policy.ts";
import type { TeamWorkspace } from "../entry/AccountTeamWindow.tsx";
import type { PendingPost } from "../mattermost/account-delivery.ts";
import { createChannelHistoryChanges } from "../mattermost/channel-history-changes.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import type {
  ComposerDraft,
  DraftLocation,
} from "../mattermost/native-rest.ts";
import { outgoingRowState } from "../mattermost/outgoing-row-state.ts";
import { projectTeamSidebar } from "../mattermost/team-sidebar.ts";
import {
  sidebarPreferences,
  workspaceServerPolicy,
} from "../mattermost/workspace-preferences.ts";
import { ChannelsWorkspace } from "./ChannelsWorkspace.tsx";
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

function mount(
  collapsed: boolean,
  online = true,
  options: {
    archived?: boolean;
    direct?: "D" | "G";
    rootAuthor?: string;
    pending?: PendingPost;
    writable?: boolean;
    type?: string;
    second?: boolean;
    draftRead?: Promise<void>;
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
          options.direct && id === general
            ? [userId, "v".repeat(26)].join("__")
            : name,
        displayName: name,
        type: id === general ? (options.direct ?? "O") : "O",
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
  const readThreadPage = vi
    .fn<Connection["readThreadPage"]>()
    .mockImplementation(async ({ rootId }) =>
      rootId === secondRoot.id
        ? { ...page, root: secondRoot, replies: [] }
        : { ...page, root: { ...root, type: options.type ?? root.type } },
    );
  const drafts = new Map<string, ComposerDraft>();
  const draftKey = ({ channelId, rootId }: DraftLocation) =>
    JSON.stringify([channelId, rootId]);
  let revision = 0;
  const changes = createChannelHistoryChanges();
  const connection = {
    subscribeToChannelHistory: changes.subscribe,
    notifyChannelHistoryChanged: changes.notify,
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
    readTeamSidebar: vi
      .fn()
      .mockResolvedValue({ selectedChannel: general, data }),
    refreshTeamSidebar: vi.fn(),
    selectSidebarChannel: vi.fn().mockResolvedValue(true),
    readSavedTeamRoles: vi.fn().mockResolvedValue({
      systemRoles: "",
      definitions: [
        {
          name: "writer",
          permissions: options.writable === false ? [] : ["create_post"],
        },
      ],
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
  const workspace: TeamWorkspace = {
    messages: {
      dialogOpen: false,
      open: vi.fn(),
      clear: vi.fn(),
      position: null,
      savedReturn: null,
      returnToSaved: vi.fn(),
      endSaved: vi.fn(),
      completeChannelChoice: vi.fn(),
      closeSavedSurface: vi.fn(),
      enqueue: (work) => work(),
    },
    connection: connection as unknown as Connection,
    serverUrl: "https://chat.example.test/team/chat",
    userId,
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
          },
          {},
        ),
      },
      user: sidebarPreferences(userId, []),
      userReadFailed: false,
      retry: vi.fn(),
    },
  };
  const view = render(
    <ChannelsWorkspace workspace={workspace} language="en" />,
  );
  return {
    ...connection,
    unmount: view.unmount,
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
  expect(document.activeElement).toBe(copy);
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
    fireEvent.click(
      screen.getByRole("button", { name: /Open thread, 1 reply/ }),
    );
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
    expect(document.activeElement).toBe(action);
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
    expect(
      Boolean(within(row).queryByRole("button", { name: "Message actions" })),
    ).toBe(visible);
  },
);

test("a device policy change closes the open menu and hides both explicit copy actions", async () => {
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
    expect(
      screen.getByRole("dialog", { name: "Message actions" }),
    ).toBeTruthy();
    act(() => change(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Message actions" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy text" })).toBeNull();
    expect(write).not.toHaveBeenCalled();
    act(() => change(true));
    expect(await rowActions(root.message)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    await screen.findByText("Text copied.");
    expect(write.mock.calls).toEqual([["Previous local attempt"]]);
  } finally {
    policy.mockRestore();
  }
});
