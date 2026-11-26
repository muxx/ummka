import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
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

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
const id = (key: string) => key.repeat(26);
export const user = id("u"),
  winter = id("t"),
  summer = id("s"),
  design = id("d"),
  other = id("k"),
  firstFile = id("a"),
  secondFile = id("b");
export const home = id("h");
export const bookmark = id("c");
export const root: LocalPost = {
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
export const reply: LocalPost = {
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
export function fixture({
  collapsed = true,
  cross = false,
  direct = false,
  archivedHome = false,
  initialTeam = winter,
  launch,
}: {
  collapsed?: boolean;
  cross?: boolean;
  direct?: boolean;
  archivedHome?: boolean;
  initialTeam?: string | null;
  launch?: typeof getDeviceLaunchContext;
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
  let selectedTeam = initialTeam;
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
          deleteAt: archivedHome && id === home ? 1 : 0,
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
      definitions: [
        {
          name: "writer",
          permissions: ["create_post", "read_channel_content"],
        },
      ],
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
    openRecentMentions: vi.fn<Account["openRecentMentions"]>(),
    readSavedPosts: vi.fn<Account["readSavedPosts"]>().mockResolvedValue({
      items: [
        {
          id: root.id,
          channelId: design,
          userId: user,
          message: "Saved **root** [preview](https://example.test/notes)",
          createAt: 123,
          isPinned: true,
        },
        {
          id: reply.id,
          channelId: design,
          userId: user,
          message: "Saved\n\n- reply\n- preview",
          createAt: 345,
          rootId: root.id,
        },
      ],
      firstInaccessiblePostTime: 0,
    }),
    readSavedPostsAtOffset: vi.fn<Account["readSavedPostsAtOffset"]>(),
    readSavedPostUpperBound: vi
      .fn<Account["readSavedPostUpperBound"]>()
      .mockResolvedValue(2),
    readPinnedChannelPosts: vi
      .fn<Account["readPinnedChannelPosts"]>()
      .mockResolvedValue({
        items: [
          {
            id: root.id,
            channelId: home,
            userId: user,
            message: "Home ![pin](https://example.test/badge)",
            isPinned: true,
          },
        ],
        firstInaccessiblePostTime: 0,
      }),
    setPostSaved: vi.fn<Account["setPostSaved"]>().mockResolvedValue(undefined),
    setPostPinned: vi
      .fn<Account["setPostPinned"]>()
      .mockResolvedValue(undefined),
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
      root: { ...root, messageSource: undefined, rootId: "", deleteAt: 0 },
      replies: [{ ...reply, messageSource: undefined, deleteAt: 0 }],
      next: null,
    }),
  };
  if (launch) vi.mocked(getDeviceLaunchContext).mockImplementation(launch);
  else
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
export async function search() {
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
