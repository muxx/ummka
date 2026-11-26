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
import { App } from "../App.tsx";
import { createChannelHistoryChanges } from "../mattermost/channel-history-changes.ts";
import { getDeviceLaunchContext } from "../mattermost/device-launch.ts";
import type { LocalPost } from "../mattermost/local-history.ts";
import { openAccountRestConnection } from "../mattermost/native-rest.ts";
import { projectTeamSidebar } from "../mattermost/team-sidebar.ts";
import {
  sidebarPreferences,
  workspaceServerPolicy,
} from "../mattermost/workspace-preferences.ts";
import "./workspace-dom.test-utils.ts";

vi.mock("../mattermost/device-launch.ts", () => ({
  getDeviceLaunchContext: vi.fn(),
}));
vi.mock("../mattermost/native-rest.ts", () => ({
  openAccountRestConnection: vi.fn(),
}));
let nativeBack: (() => void) | undefined;
vi.mock("@tauri-apps/api/app", () => ({
  onBackButtonPress: vi.fn(async (pressed: () => void) => {
    nativeBack = pressed;
    return {
      unregister() {
        if (nativeBack === pressed) nativeBack = undefined;
      },
    };
  }),
}));
type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
const id = (key: string) => key.repeat(26);
const user = id("u"),
  winter = id("t"),
  summer = id("s"),
  home = id("h"),
  design = id("d"),
  other = id("k"),
  firstFile = id("a"),
  secondFile = id("b"),
  bookmark = id("c");
const root: LocalPost = {
  id: id("r"),
  channelId: design,
  rootId: null,
  userId: user,
  message: "Published root",
  messageSource: null,
  type: "",
  createAt: 123,
  updateAt: 123,
  editAt: 0,
  isPinned: false,
  hashtags: "",
};
const reply: LocalPost = {
  ...root,
  id: id("p"),
  rootId: root.id,
  createAt: 345,
  updateAt: 345,
  message: "Exact remote reply",
};
const file = (fileId: string, name: string, postId: string | null) => ({
  id: fileId,
  name,
  channelId: design,
  postId,
});
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function fixture({
  collapsed = true,
  cross = false,
  direct = false,
}: {
  collapsed?: boolean;
  cross?: boolean;
  direct?: boolean;
} = {}) {
  const serverUrl = "https://example.test";
  const teams = [
    {
      id: winter,
      name: "winter",
      displayName: "Winter",
      preferenceRank: null,
      roles: "writer",
    },
    {
      id: summer,
      name: "summer",
      displayName: "Summer",
      preferenceRank: null,
      roles: "writer",
    },
  ];
  let selectedTeam = winter;
  const selected = new Map([
    [winter, home],
    [summer, other],
  ]);
  const targetTeam = cross ? summer : winter;
  const rows = (team: string) => [
    ...(team === winter
      ? [
          [home, "Home"],
          [other, "Third channel"],
        ]
      : [[other, "Other"]]),
    ...(team === targetTeam ? [[design, "Design"]] : []),
  ];
  const readSidebar = async (team: string) => ({
    selectedChannel: selected.get(team) ?? null,
    data: projectTeamSidebar({
      teamId: team,
      channels: rows(team).map(([id, name]) => ({
        channel: {
          id,
          name:
            direct && id === design ? [user, "z".repeat(26)].join("__") : name,
          displayName: direct && id === design ? "" : name,
          type: direct && id === design ? "D" : "O",
          deleteAt: 0,
        },
        membership: { userId: user, channelId: id, roles: "writer" },
      })),
      categories: [
        {
          id: "channels",
          type: "channels",
          displayName: "Channels",
          sorting: "manual",
          collapsed: false,
          muted: false,
          channelIds: rows(team)
            .map(([id]) => id)
            .filter((id) => !direct || id !== design),
        },
      ],
    }),
  });
  const targetInfo = {
    postId: root.id,
    channel: {
      id: design,
      kind: "O" as const,
      displayName: "Design",
      joined: true,
    },
    team: {
      id: targetTeam,
      kind: "O" as const,
      displayName: cross ? "Summer" : "Winter",
      joined: true,
    },
  };
  const drafts = new Map([
    [home, "Original unfinished draft"],
    [design, "Target draft"],
    [root.id, "Unfinished reply"],
  ]);
  const changes = createChannelHistoryChanges();
  const account = {
    subscribeToChannelHistory: changes.subscribe,
    notifyChannelHistoryChanged: changes.notify,
    rid: 9,
    close: vi.fn().mockResolvedValue(undefined),
    signOutOnDevice: vi.fn().mockResolvedValue("removed"),
    readJoinedTeams: vi.fn(async () => ({ teams, selectedTeam })),
    refreshJoinedTeams: vi.fn().mockResolvedValue(true),
    selectJoinedTeam: vi.fn(async (next: string) => {
      selectedTeam = next;
      return true;
    }),
    readTeamSidebar: vi.fn(readSidebar),
    refreshTeamSidebar: vi.fn().mockResolvedValue(true),
    selectSidebarChannel: vi.fn(async (t: string, c: string) => {
      selected.set(t, c);
      return true;
    }),
    readWorkspaceSettings: vi.fn().mockResolvedValue({
      server: workspaceServerPolicy(
        {
          CollapsedThreads: collapsed ? "always_on" : "disabled",
          EnableCrossTeamSearch: "true",
          EnableFileSearch: "true",
          EnableFileAttachments: "true",
        },
        {},
      ),
      preferences: sidebarPreferences(user, []),
    }),
    refreshWorkspaceServerPolicy: vi.fn(),
    readSavedTeamRoles: vi.fn().mockResolvedValue({
      systemRoles: "",
      definitions: [{ name: "writer", permissions: ["create_post"] }],
    }),
    refreshTeamRoles: vi.fn(),
    readSavedProfiles: vi
      .fn()
      .mockResolvedValue({ profiles: {}, usernames: {} }),
    refreshSavedProfiles: vi.fn(),
    readDraft: vi.fn<Account["readDraft"]>(async (p) => ({
      revision: "1",
      message: drafts.get(p.rootId ?? p.channelId) ?? "",
    })),
    subscribeToPostActivity: vi.fn(() => () => {}),
    readPendingPosts: vi.fn().mockResolvedValue([]),
    readRecentTeamSearches: vi.fn().mockResolvedValue([]),
    rememberTeamSearch: vi.fn().mockResolvedValue(true),
    readSearchTimezone: vi.fn().mockResolvedValue("UTC"),
    readPostSearchPage: vi.fn().mockResolvedValue({
      items: [
        { id: root.id, channelId: design, message: "Search root snippet" },
        { id: reply.id, channelId: design, message: "Search reply snippet" },
      ],
      matches: null,
      isEnd: true,
      firstInaccessiblePostTime: 0,
    }),
    readFileSearchPage: vi.fn<Account["readFileSearchPage"]>(async (q) => ({
      items:
        q.page === 0
          ? [
              file(bookmark, "bookmark.pdf", null),
              file(firstFile, "first.pdf", root.id),
            ]
          : [file(secondFile, "second.pdf", root.id)],
      isEnd: q.page > 0,
      firstInaccessibleFileTime: 0,
    })),
    readFileAnchor: vi.fn<Account["readFileAnchor"]>(async (fileId) => ({
      fileId,
      postId: root.id,
      channelId: design,
    })),
    readPostDestination: vi.fn<Account["readPostDestination"]>(
      async (postId) => ({ ...targetInfo, postId }),
    ),
    readPostAnchor: vi.fn<Account["readPostAnchor"]>(async (postId) => ({
      postId,
      channelId: design,
      rootId: postId === reply.id ? root.id : null,
      post: postId === reply.id ? reply : root,
    })),
    changeOwnMembership: vi
      .fn<Account["changeOwnMembership"]>()
      .mockResolvedValue({ kind: "applied" }),
    readChannelWindow: vi.fn<Account["readChannelWindow"]>(async (q) => ({
      posts: q.kind === "around" ? [q.postId === root.id ? root : reply] : [],
      newer: { kind: "end" },
      older: { kind: "end" },
      firstInaccessiblePostTime: 0,
    })),
    refreshChannelHistory: vi.fn().mockResolvedValue({ kind: "applied" }),
    readSavedPost: vi.fn().mockResolvedValue(root),
    readThreadPage: vi.fn().mockResolvedValue({
      kind: "page",
      root: { ...root, rootId: "", deleteAt: 0 },
      replies: [{ ...reply, deleteAt: 0 }],
      next: null,
    }),
  };
  vi.mocked(getDeviceLaunchContext).mockResolvedValue({
    status: "ready",
    serverUrl,
    userId: user,
  });
  vi.mocked(openAccountRestConnection).mockResolvedValue(
    account as unknown as Account,
  );
  const view = render(<App language="en" />);
  return { account, targetInfo, view };
}
async function search() {
  const trigger = await screen.findByRole("button", { name: "Search" });
  fireEvent.click(trigger);
  const form = within(await screen.findByRole("dialog"));
  fireEvent.change(form.getByRole("searchbox"), {
    target: { value: "window" },
  });
  fireEvent.click(form.getByRole("button", { name: "Search" }));
  return within(
    await screen.findByRole("complementary", { name: "Search results" }),
  );
}
test.each([
  [true, root],
  [false, reply],
  [true, reply],
] as const)(
  "opens a search row at the exact published post and restores the originating draft %#",
  async (collapsed, target) => {
    const { account } = fixture({ collapsed });
    const results = await search();
    const trigger = await results.findByRole("button", {
      name: target === root ? "Search root snippet" : "Search reply snippet",
    });
    fireEvent.click(trigger);
    const row = await screen.findByText(target.message);
    await waitFor(() =>
      expect(document.activeElement).toBe(row.closest("article")),
    );
    expect(account.readPostAnchor).toHaveBeenCalledTimes(1);
    expect(
      account.readChannelWindow.mock.calls.some(
        ([q]) => q.channelId === design && q.kind === "latest",
      ),
    ).toBe(false);
    if (collapsed && target === reply) {
      expect(
        screen.getByRole("complementary", { name: "Thread" }).contains(row),
      ).toBe(true);
      await waitFor(() =>
        expect(
          screen.getByRole<HTMLTextAreaElement>("textbox", {
            name: "Reply in thread…",
          }).value,
        ).toBe("Unfinished reply"),
      );
    } else
      await waitFor(() =>
        expect(
          screen.getByRole<HTMLTextAreaElement>("textbox", {
            name: "Message #Design…",
          }).value,
        ).toBe("Target draft"),
      );
    fireEvent.click(screen.getByRole("button", { name: "Back to results" }));
    const restored = await screen.findByRole("button", {
      name: trigger.textContent ?? "",
    });
    await waitFor(() => expect(document.activeElement).toBe(restored));
    expect(account.readPostSearchPage).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLTextAreaElement>("textbox", {
          name: "Message #Home…",
        }).value,
      ).toBe("Original unfinished draft"),
    );
    expect(document.activeElement).toBe(restored);
  },
);
test.each([root, reply])(
  "one Escape from an addressed post restores its search row",
  async (target) => {
    const { account } = fixture();
    const results = await search();
    const action = {
      name: target === root ? "Search root snippet" : "Search reply snippet",
    };
    fireEvent.click(await results.findByRole("button", action));
    const addressed = await screen.findByText(target.message);
    await waitFor(() =>
      expect(document.activeElement).toBe(addressed.closest("article")),
    );
    fireEvent.keyDown(addressed, { key: "Escape" });
    const restored = await screen.findByRole("button", action);
    await waitFor(() => expect(document.activeElement).toBe(restored));
    expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
    expect(account.readPostSearchPage).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLTextAreaElement>("textbox", {
          name: "Message #Home…",
        }).value,
      ).toBe("Original unfinished draft"),
    );
  },
);

test("a thread opened manually above an addressed channel closes before returning to search", async () => {
  fixture();
  const results = await search();
  const action = { name: "Search root snippet" };
  fireEvent.click(await results.findByRole("button", action));
  const addressed = (await screen.findByText(root.message)).closest("article");
  if (!addressed) throw Error("Expected the addressed row");
  fireEvent.click(
    within(addressed).getByRole("button", { name: /Open thread/ }),
  );
  const thread = await screen.findByRole("complementary", { name: "Thread" });
  fireEvent.keyDown(thread, { key: "Escape" });
  expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
  expect(screen.queryByRole("button", action)).toBeNull();
  expect(screen.getByRole("button", { name: "Back to results" })).toBeTruthy();
  fireEvent.keyDown(addressed, { key: "Escape" });
  const restored = await screen.findByRole("button", action);
  await waitFor(() => expect(document.activeElement).toBe(restored));
});

test("the compact destination keeps a visible way back when its channel disappears", async () => {
  const { account } = fixture();
  const results = await search();
  const action = { name: "Search reply snippet" };
  fireEvent.click(await results.findByRole("button", action));
  await screen.findByText(reply.message);
  const read = account.readTeamSidebar.getMockImplementation();
  if (!read) throw Error("Fixture needs a saved sidebar");
  account.readTeamSidebar.mockImplementation(async (team) => {
    const saved = await read(team);
    return {
      ...saved,
      data: {
        ...saved.data,
        channels: saved.data.channels.filter((row) => row.id !== design),
      },
    };
  });
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  try {
    act(() => window.dispatchEvent(new Event("offline")));
    await waitFor(() => expect(screen.queryByText(reply.message)).toBeNull());
    const back = screen.getByRole("button", { name: "Back to results" });
    expect(back.closest(".channels-panes")?.getAttribute("data-page")).toBe(
      "conversation",
    );
    expect(
      within(screen.getByRole("main")).getByText(
        "This content is no longer available to your account.",
      ),
    ).toBeTruthy();
    fireEvent.click(back);
    const restored = await screen.findByRole("button", action);
    await waitFor(() => expect(document.activeElement).toBe(restored));
    expect(account.readPostSearchPage).toHaveBeenCalledTimes(1);
  } finally {
    online.mockRestore();
  }
});
test("restores the second file for one post and keeps bookmarks without a post action", async () => {
  const { account } = fixture();
  const results = await search();
  fireEvent.click(await results.findByRole("button", { name: "Files" }));
  await results.findByText("bookmark.pdf");
  expect(
    results.queryByRole("button", {
      name: "Show message with file bookmark.pdf",
    }),
  ).toBeNull();
  fireEvent.click(results.getByRole("button", { name: "Load more" }));
  fireEvent.click(
    await results.findByRole("button", {
      name: "Show message with file second.pdf",
    }),
  );
  await screen.findByText(root.message);
  expect(account.readFileAnchor.mock.calls[0]?.[0]).toBe(secondFile);
  fireEvent.click(screen.getByRole("button", { name: "Back to results" }));
  const target = await screen.findByRole("button", {
    name: "Show message with file second.pdf",
  });
  await waitFor(() => expect(document.activeElement).toBe(target));
  expect(account.readFileSearchPage).toHaveBeenCalledTimes(2);
  expect(account.rememberTeamSearch).toHaveBeenCalledTimes(1);
});
test("a result in another team survives replacement of the Channels workspace and closes its old search", async () => {
  const { account } = fixture({ cross: true });
  const results = await search();
  fireEvent.click(
    await results.findByRole("button", { name: "Search root snippet" }),
  );
  const row = await screen.findByText(root.message);
  await waitFor(() =>
    expect(document.activeElement).toBe(row.closest("article")),
  );
  expect(account.selectJoinedTeam).toHaveBeenCalledExactlyOnceWith(summer);
  expect(screen.getByRole("button", { name: /team, Summer/i })).toBeTruthy();
  expect(screen.queryByText("Back to results")).toBeNull();
  expect(
    account.refreshChannelHistory.mock.calls
      .flat()
      .some((q) => q.channelId === other),
  ).toBe(false);
});
test.each(["deleted", "archived", "unattached"] as const)(
  "a %s result leaves its origin available",
  async (reason) => {
    const { account } = fixture();
    const results = await search();
    let button: HTMLElement;
    if (reason === "unattached") {
      account.readFileAnchor.mockResolvedValueOnce({
        fileId: firstFile,
        channelId: design,
        postId: null,
      });
      fireEvent.click(await results.findByRole("button", { name: "Files" }));
      button = await results.findByRole("button", {
        name: "Show message with file first.pdf",
      });
    } else {
      account.readPostAnchor.mockRejectedValueOnce(
        new ResponseError(
          new Response(null, {
            status: reason === "deleted" ? 404 : 403,
            headers:
              reason === "archived"
                ? { "first-inaccessible-post-time": "1" }
                : {},
          }),
        ),
      );
      button = await results.findByRole("button", {
        name: "Search root snippet",
      });
    }
    fireEvent.click(button);
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("alert").textContent).toMatch(
      reason === "deleted"
        ? /deleted/
        : reason === "archived"
          ? /history/
          : /no longer attached/,
    );
    fireEvent.click(dialog.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(account.selectSidebarChannel).not.toHaveBeenCalled();
  },
);
test("private consent can be dismissed before joining and a confirmed join opens the fresh message", async () => {
  const { account, targetInfo } = fixture();
  const unjoined = {
    ...targetInfo,
    channel: { ...targetInfo.channel, kind: "P" as const, joined: false },
  };
  account.readPostDestination.mockResolvedValue(unjoined);
  const results = await search(),
    row = await results.findByRole("button", { name: "Search root snippet" });
  fireEvent.click(row);
  const first = within(await screen.findByRole("dialog"));
  await act(async () =>
    fireEvent.click(first.getByRole("button", { name: "Cancel" })),
  );
  expect(account.changeOwnMembership).not.toHaveBeenCalled();
  fireEvent.click(row);
  const prompt = within(await screen.findByRole("dialog"));
  account.changeOwnMembership.mockImplementationOnce(async () => {
    account.readPostDestination.mockResolvedValue(targetInfo);
    return { kind: "applied" };
  });
  fireEvent.click(prompt.getByRole("button", { name: "Join and open" }));
  await screen.findByText(root.message);
  expect(account.changeOwnMembership).toHaveBeenCalledExactlyOnceWith(
    { kind: "channel", id: design },
    "join",
  );
});
test("manual channel selection cancels a delayed result, including a late 401", async () => {
  const { account } = fixture();
  let reject!: (reason: unknown) => void;
  account.readPostAnchor.mockReturnValueOnce(
    new Promise((_resolve, no) => {
      reject = no;
    }),
  );
  const results = await search();
  fireEvent.click(
    await results.findByRole("button", { name: "Search root snippet" }),
  );
  await waitFor(() => expect(account.readPostAnchor).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Third channel" }));
  await act(async () =>
    reject(new ResponseError(new Response(null, { status: 401 }))),
  );
  expect(account.signOutOnDevice).not.toHaveBeenCalled();
  expect(screen.queryByText(root.message)).toBeNull();
  expect(screen.getByRole("heading", { name: "Third channel" })).toBeTruthy();
});

test("only the selected account’s joined direct conversation can open within its current team", async () => {
  const { account, targetInfo } = fixture({ direct: true });
  const info = {
    postId: root.id,
    team: null,
    channel: { ...targetInfo.channel, kind: "D" as const, joined: false },
  };
  account.readPostDestination.mockResolvedValue(info);
  const results = await search(),
    button = await results.findByRole("button", {
      name: "Search root snippet",
    });
  fireEvent.click(button);
  const deny = within(await screen.findByRole("dialog"));
  expect(deny.getByRole("alert").textContent).toMatch(/unavailable/);
  expect(account.readPostAnchor).not.toHaveBeenCalled();
  expect(account.changeOwnMembership).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.click(deny.getByRole("button", { name: "OK" })),
  );
  account.readPostDestination.mockResolvedValue({
    ...info,
    channel: { ...info.channel, joined: true },
  });
  fireEvent.click(button);
  const row = await screen.findByText(root.message);
  await waitFor(() =>
    expect(document.activeElement).toBe(row.closest("article")),
  );
  expect(account.selectSidebarChannel).toHaveBeenCalledExactlyOnceWith(
    winter,
    design,
  );
  expect(account.selectJoinedTeam).not.toHaveBeenCalled();
});
test("offline results remain readable and only a new explicit online activation reads the target", async () => {
  const { account } = fixture();
  const results = await search();
  const row = await results.findByRole("button", {
    name: "Search root snippet",
  });
  const online = vi.spyOn(navigator, "onLine", "get");
  try {
    online.mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(row.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row);
    expect(account.readPostAnchor).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(account.readPostDestination).not.toHaveBeenCalled();
    fireEvent.click(row);
    await screen.findByText(root.message);
    expect(account.readPostDestination).toHaveBeenCalledTimes(1);
  } finally {
    online.mockRestore();
  }
});
test("repeated activation shares one request and a different result supersedes a late session error", async () => {
  const { account } = fixture();
  let fail!: (error: unknown) => void;
  account.readPostAnchor.mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  const results = await search();
  const old = await results.findByRole("button", {
    name: "Search root snippet",
  });
  fireEvent.click(old);
  fireEvent.click(old);
  await waitFor(() => expect(account.readPostAnchor).toHaveBeenCalledTimes(1));
  fireEvent.click(
    results.getByRole("button", { name: "Search reply snippet" }),
  );
  const row = await screen.findByText(reply.message);
  await act(async () =>
    fail(new ResponseError(new Response(null, { status: 401 }))),
  );
  expect(document.activeElement).toBe(row.closest("article"));
  expect(account.signOutOnDevice).not.toHaveBeenCalled();
});
test("the destination adopts newly published membership while the source sidebar still lacks the joined channel", async () => {
  const { account, targetInfo } = fixture();
  const original = account.readTeamSidebar.getMockImplementation();
  if (!original) throw Error("Fixture sidebar required");
  let published = false;
  account.readTeamSidebar.mockImplementation(async (team) => {
    const snapshot = await original(team);
    return published
      ? snapshot
      : {
          ...snapshot,
          data: {
            ...snapshot.data,
            channels: snapshot.data.channels.filter(
              (item) => item.id !== design,
            ),
          },
        };
  });
  const results = await search();
  const refreshes = account.refreshTeamSidebar.mock.calls.length;
  account.readPostDestination.mockResolvedValueOnce({
    ...targetInfo,
    channel: { ...targetInfo.channel, joined: false },
  });
  account.refreshTeamSidebar.mockImplementationOnce(async () => {
    published = true;
    return true;
  });
  fireEvent.click(
    await results.findByRole("button", { name: "Search root snippet" }),
  );
  await screen.findByText(root.message);
  expect(await screen.findByText("You joined the channel.")).toBeTruthy();
  expect(account.refreshTeamSidebar).toHaveBeenCalledTimes(refreshes + 1);
});

test("an accepted team join followed by a server refusal reports both outcomes without switching teams", async () => {
  const { account, targetInfo } = fixture({ cross: true });
  const outside = {
    ...targetInfo,
    team: { ...targetInfo.team, joined: false },
    channel: { ...targetInfo.channel, joined: false, kind: "P" as const },
  };
  account.readPostDestination.mockResolvedValue(outside);
  account.changeOwnMembership.mockImplementation(async (membership) => {
    if (membership.kind === "team") {
      account.readPostDestination.mockResolvedValue({
        ...outside,
        team: targetInfo.team,
      });
      return { kind: "applied" };
    }
    return {
      kind: "refused",
      refusal: {
        status: 403,
        code: "channel.join.denied",
        message: "Channel invitation required",
      },
    };
  });
  const results = await search();
  const button = await results.findByRole("button", {
    name: "Search root snippet",
  });
  fireEvent.click(button);
  const prompt = within(await screen.findByRole("dialog"));
  fireEvent.click(prompt.getByRole("button", { name: "Join and open" }));
  const notice = await screen.findByRole("alert");
  expect(notice.textContent).toContain("You joined the team.");
  expect(notice.textContent).toContain("Channel invitation required");
  expect(account.selectJoinedTeam).not.toHaveBeenCalled();
  expect(account.selectSidebarChannel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(document.activeElement).toBe(button));
});
test("manually switching teams while a result is being verified keeps the new team after a late unauthorized response", async () => {
  const { account } = fixture();
  let reject!: (reason: unknown) => void;
  account.readPostAnchor.mockReturnValueOnce(
    new Promise((_resolve, no) => {
      reject = no;
    }),
  );
  const results = await search();
  fireEvent.click(
    await results.findByRole("button", { name: "Search root snippet" }),
  );
  await waitFor(() => expect(account.readPostAnchor).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: /team, Winter/i }));
  fireEvent.click(await screen.findByRole("button", { name: /Summer/i }));
  await screen.findByRole("button", { name: /team, Summer/i });
  await act(async () =>
    reject(new ResponseError(new Response(null, { status: 401 }))),
  );
  expect(
    screen.queryByRole("complementary", { name: "Search results" }),
  ).toBeNull();
  expect(screen.getByRole("heading", { name: "Other" })).toBeTruthy();
  expect(account.signOutOnDevice).not.toHaveBeenCalled();
  expect(account.selectSidebarChannel).not.toHaveBeenCalled();
});

test("Back while joining keeps ownership with the waiting dialog after the submit button disappears", async () => {
  const { account, targetInfo } = fixture();
  account.readPostDestination.mockResolvedValue({
    ...targetInfo,
    channel: { ...targetInfo.channel, kind: "P", joined: false },
  });
  let finish!: (value: { kind: "applied" }) => void;
  const joining = new Promise<{ kind: "applied" }>((resolve) => {
    finish = resolve;
  });
  account.changeOwnMembership.mockReturnValueOnce(joining);
  const results = await search();
  fireEvent.click(
    await results.findByRole("button", { name: "Search root snippet" }),
  );
  const button = within(await screen.findByRole("dialog")).getByRole("button", {
    name: "Join and open",
  });
  button.focus();
  fireEvent.click(button);
  const waiting = await screen.findByRole("dialog", { name: "Joining…" });
  await waitFor(() =>
    expect(account.changeOwnMembership).toHaveBeenCalledTimes(1),
  );
  expect(waiting.contains(document.activeElement)).toBe(false);
  if (import.meta.env.UMMKA_ANDROID === true) {
    expect(nativeBack).toBeTypeOf("function");
    act(() => nativeBack?.());
  } else fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "Joining…" })).toBe(waiting);
  expect(
    screen.getByRole("complementary", { name: "Search results" }),
  ).toBeTruthy();
  account.readPostDestination.mockResolvedValue(targetInfo);
  await act(async () => finish({ kind: "applied" }));
  await screen.findByText(root.message);
  expect(account.changeOwnMembership).toHaveBeenCalledTimes(1);
});
