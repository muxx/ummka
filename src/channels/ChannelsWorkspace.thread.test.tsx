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
import type { PendingPost } from "../mattermost/account-delivery.ts";
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
const secondRoot = { ...root, id: "x".repeat(26), message: "Another question" };

function mount(
  collapsed: boolean,
  online = true,
  options: {
    archived?: boolean;
    writable?: boolean;
    type?: string;
    second?: boolean;
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
        name,
        displayName: name,
        type: "O",
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
  const connection = {
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
    readDraft: vi.fn<Connection["readDraft"]>(
      async (place) =>
        drafts.get(draftKey(place)) ?? { message: "", revision: null },
    ),
    saveDraft: vi.fn<Connection["saveDraft"]>(async (place) => {
      const key = draftKey(place);
      const existing = drafts.get(key) ?? { message: "", revision: null };
      if (place.expectedRevision !== existing.revision)
        return { kind: "conflict", draft: existing };
      const draft = { message: place.message, revision: String(++revision) };
      drafts.set(key, draft);
      return { kind: "saved", draft };
    }),
    submitDraft: vi.fn(),
    readPendingPosts: vi
      .fn<Connection["readPendingPosts"]>()
      .mockResolvedValue([]),
    retireDeliveredPosts: vi.fn().mockResolvedValue(0),
    getOutgoingPostState: (post: PendingPost) =>
      outgoingRowState(post, false, true),
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
  const view = render(
    <ChannelsWorkspace workspace={workspace} language="en" onEnded={vi.fn()} />,
  );
  return {
    ...connection,
    setOnline(next: boolean) {
      view.rerender(
        <ChannelsWorkspace
          workspace={{ ...workspace, online: next }}
          language="en"
          onEnded={vi.fn()}
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
    fireEvent.keyDown(replyBox, { key: "Enter" });
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

test("two thread drafts and the channel stay separate, and Enter sends the reply to its root", async () => {
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
  fireEvent.keyDown(reopened, { key: "Enter" });
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

test("a confirmed own reply beyond a gap stays after the lower boundary and becomes the server row once", async () => {
  const connection = mount(true);
  const canonical = {
    ...reply,
    id: "n".repeat(26),
    createAt: 400,
    updateAt: 400,
    message: "Own canonical reply",
  };
  const pending: PendingPost = {
    pendingId: "local-own-reply",
    channelId: general,
    rootId: root.id,
    sequence: 1,
    createdAt: 300,
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
  const boundary = within(pane).getByRole("button", {
    name: /between these messages.*Show replies/,
  });
  expect(
    first.compareDocumentPosition(boundary) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    boundary.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(boundary);
  const confirmed = await within(pane).findByText(canonical.message);
  expect(confirmed.closest("article")).toBe(own);
  expect(own.dataset.postId).toBe(canonical.id);
  expect(own.dataset.localId).toBe(pending.pendingId);
  expect(within(pane).queryByText(pending.message)).toBeNull();
  expect(within(pane).queryByText(/between these messages/)).toBeNull();
  expect(connection.retireDeliveredPosts).toHaveBeenCalledWith([canonical.id]);
  expect(
    within(screen.getByRole("main")).queryByText(canonical.message),
  ).toBeNull();
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
