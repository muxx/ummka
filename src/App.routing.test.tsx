import "./empty-link-inbox.test-utils";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "./channels/workspace-dom.test-utils.ts";
import { App } from "./App";
import { isMobile } from "./build-platform";
import { ServerSignIn } from "./entry/ServerSignIn";
import type { PendingPost } from "./mattermost/account-delivery.ts";
import { signInWithBrowser } from "./mattermost/browser-sign-in";
import { channelProfile } from "./mattermost/channel-profiles.ts";
import { getDeviceLaunchContext } from "./mattermost/device-launch";
import { inspectInstallation } from "./mattermost/inspect-installation";
import {
  connectInstallation,
  listInstallations,
  readInstallationSelection,
  selectInstallation,
} from "./mattermost/installation-registry";
import {
  getCurrentAccountId,
  openAccountRestConnection,
  type SavedProfiles,
} from "./mattermost/native-rest";
import { outgoingRowState } from "./mattermost/outgoing-row-state.ts";

vi.mock("./mattermost/device-launch", () => ({
  getDeviceLaunchContext: vi.fn(),
}));
vi.mock("./mattermost/installation-registry", () => ({
  connectInstallation: vi.fn(),
  readInstallationSelection: vi.fn(),
  selectInstallation: vi.fn(),
  listInstallations: vi.fn(),
}));
vi.mock("./mattermost/native-rest", () => ({
  openAccountRestConnection: vi.fn(),
  getCurrentAccountId: vi.fn(),
}));
vi.mock("./mattermost/browser-sign-in", () => ({
  signInWithBrowser: vi.fn(),
  cancelBrowserSignIn: vi.fn(),
}));
vi.mock("./mattermost/inspect-installation", async (original) => ({
  ...(await original<typeof import("./mattermost/inspect-installation")>()),
  inspectInstallation: vi.fn(),
}));
const launch = vi.mocked(getDeviceLaunchContext),
  inspect = vi.mocked(inspectInstallation);
const origin = "https://chat.example.test/Work",
  user = "a".repeat(26);
const profile = {
  serverUrl: origin,
  siteName: "Winter",
  version: "10.10.1",
  passwordIdentifiers: [],
  ssoProviders: ["gitlab" as const],
  guestMagicLink: false,
};
let nativeBack: (() => void) | undefined;
vi.mock("@tauri-apps/api/app", () => ({
  onBackButtonPress: vi.fn(async (handler: () => void) => {
    nativeBack = handler;
    return {
      unregister: () => {
        if (nativeBack === handler) nativeBack = undefined;
      },
    };
  }),
}));
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test.each([true, false])(
  "only carries a known installation name into the verified signed route (%s)",
  async (sameAccount) => {
    const current = sameAccount ? user : "x".repeat(26);
    launch
      .mockResolvedValueOnce({
        status: "sign_in_required",
        serverUrl: origin,
        installations: [origin],
      })
      .mockResolvedValue({
        status: "ready",
        serverUrl: origin,
        userId: current,
        installations: [origin],
      });
    inspect.mockResolvedValue(profile);
    const signed = vi.mocked(signInWithBrowser).mockResolvedValue(user);
    const open = vi.mocked(openAccountRestConnection);
    open.mockResolvedValue({
      readJoinedTeams: async () => ({ teams: [], selectedTeam: null }),
      refreshJoinedTeams: async () => true,
      readSavedProfiles: async () => ({ profiles: {}, usernames: {} }),
      readWorkspaceSettings: async () => ({ preferences: null, server: null }),
      refreshWorkspaceServerPolicy: async () => false,
      close: async () => {},
    } as unknown as Awaited<ReturnType<typeof openAccountRestConnection>>);
    render(<App language="en" />);
    fireEvent.click(await screen.findByRole("button", { name: /GitLab/ }));
    await screen.findByRole("heading", { name: "No teams yet" });
    expect(signed).toHaveBeenCalledExactlyOnceWith(
      origin,
      "gitlab",
      expect.any(Function),
    );
    expect(open).toHaveBeenCalledExactlyOnceWith(origin, current);
    expect(screen.getByTitle(origin).textContent).toBe(
      "chat.example.test/Work",
    );
    expect(Boolean(screen.queryByText("Winter"))).toBe(sameAccount);
    expect(screen.getByText("You’re signed in.")).toBeTruthy();
    expect(inspect).toHaveBeenCalledOnce();
  },
);

test("the empty first choice returns from saved servers to the same account and focus", async () => {
  const next = `${origin}/Lab`;
  const installations = [origin, next];
  const own = {
    status: "ready",
    serverUrl: origin,
    userId: user,
    installations,
  } as const;
  launch.mockResolvedValue(own);
  vi.mocked(readInstallationSelection).mockResolvedValue({
    selected: origin,
    installations,
  });
  const open = vi.mocked(openAccountRestConnection);
  open.mockResolvedValue({
    readJoinedTeams: async () => ({ teams: [], selectedTeam: null }),
    refreshJoinedTeams: async () => true,
    readSavedProfiles: async () => ({ profiles: {}, usernames: {} }),
    readWorkspaceSettings: async () => ({ preferences: null, server: null }),
    refreshWorkspaceServerPolicy: async () => false,
    close: async () => {},
  } as unknown as Awaited<ReturnType<typeof openAccountRestConnection>>);
  render(<App language="en" />);
  const openPicker = async () => {
    await screen.findByRole("heading", { name: "No teams yet" });
    const button = screen.getByRole("button", { name: "Another server" });
    fireEvent.click(button);
    expect(
      await screen.findByRole("heading", { name: "Servers on this device" }),
    ).toBeTruthy();
  };
  await openPicker();
  fireEvent.click(screen.getByRole("button", { name: "Back to team choice" }));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Another server" }),
  );
  await openPicker();
  if (process.env.TAURI_ENV_PLATFORM === "android") {
    expect(nativeBack).toBeTypeOf("function");
    act(() => nativeBack?.());
  } else {
    fireEvent.keyDown(document.body, { key: "Escape" });
  }
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Another server" }),
  );
  await openPicker();
  fireEvent.click(
    screen.getByRole("button", { name: /Selected.*chat\.example\.test.*Work/ }),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Another server" }),
  );
  expect(open).toHaveBeenCalledExactlyOnceWith(origin, user);
  expect(selectInstallation).not.toHaveBeenCalled();
  expect(inspect).not.toHaveBeenCalled();
  await openPicker();
  fireEvent.click(screen.getByRole("button", { name: "Add server" }));
  await screen.findByRole("textbox", { name: "Server address" });
  fireEvent.keyDown(document.body, { key: "Escape" });
  const add = await screen.findByRole("button", { name: "Add server" });
  expect(document.activeElement).toBe(add);

  const nextUser = "x".repeat(26);
  vi.mocked(selectInstallation).mockImplementationOnce(async () => {
    launch.mockResolvedValue({ ...own, serverUrl: next, userId: nextUser });
  });
  fireEvent.click(add);
  const input = await screen.findByRole("textbox", { name: "Server address" });
  fireEvent.change(input, { target: { value: "chat.example.test/Work/Lab/" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  await screen.findByRole("heading", { name: "No teams yet" });
  expect(screen.getByTitle(next)).toBeTruthy();
  expect(selectInstallation).toHaveBeenCalledExactlyOnceWith(next);
  expect(open.mock.calls).toEqual([
    [origin, user],
    [next, nextUser],
  ]);
  expect(inspect).not.toHaveBeenCalled();
  expect(signInWithBrowser).not.toHaveBeenCalled();
});

test.each([true, false])(
  "returning after adding a third server uses the current registry (%s)",
  async (originalRegistered) => {
    const lab = `${origin}/Lab`;
    const third = "https://third.example.test";
    const otherUser = "z".repeat(26);
    let selected = origin;
    let installations = [origin, lab];
    let authenticatedThird = false;
    launch.mockImplementation(async () =>
      selected === third && !authenticatedThird
        ? { status: "sign_in_required", serverUrl: third, installations }
        : {
            status: "ready",
            serverUrl: selected,
            userId: selected === origin ? user : otherUser,
            installations,
          },
    );
    vi.mocked(readInstallationSelection).mockImplementation(async () => ({
      installations,
      selected,
    }));
    vi.mocked(connectInstallation).mockImplementation(async (url) => {
      installations = originalRegistered ? [origin, lab, url] : [lab, url];
      selected = url;
    });
    vi.mocked(selectInstallation).mockImplementation(async (url) => {
      if (!installations.includes(url)) throw "not_registered";
      selected = url;
    });
    inspect.mockResolvedValue({
      ...profile,
      serverUrl: third,
      siteName: "Third",
    });
    const open = vi.mocked(openAccountRestConnection);
    open.mockResolvedValue({
      readJoinedTeams: async () => ({ teams: [], selectedTeam: null }),
      refreshJoinedTeams: async () => true,
      readSavedProfiles: async () => ({ profiles: {}, usernames: {} }),
      readWorkspaceSettings: async () => ({ preferences: null, server: null }),
      refreshWorkspaceServerPolicy: async () => false,
      close: async () => {},
    } as unknown as Awaited<ReturnType<typeof openAccountRestConnection>>);
    render(<App language="en" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Another server" }),
    );
    async function add() {
      fireEvent.click(screen.getByRole("button", { name: "Add server" }));
      const input = await screen.findByRole("textbox", {
        name: "Server address",
      });
      fireEvent.change(input, { target: { value: third } });
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    }
    await add();
    await screen.findByText("Third");
    fireEvent.click(
      screen.getByRole("button", { name: "Change server address" }),
    );
    await screen.findByRole("textbox", { name: "Server address" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    if (originalRegistered) {
      const restored = await screen.findByRole("button", {
        name: "Add server",
      });
      expect(document.activeElement).toBe(restored);
      expect(screen.getByTitle(third)).toBeTruthy();
      expect(selected).toBe(origin);
      expect(open).toHaveBeenCalledExactlyOnceWith(origin, user);
      authenticatedThird = true;
      await add();
      await screen.findByRole("heading", { name: "No teams yet" });
      expect(screen.getByTitle(third)).toBeTruthy();
      expect(open.mock.calls).toEqual([
        [origin, user],
        [third, otherUser],
      ]);
      expect(selected).toBe(third);
    } else {
      await screen.findByRole("alert");
      expect(selected).toBe(third);
      expect(installations).toEqual([lab, third]);
      expect(open).toHaveBeenCalledExactlyOnceWith(origin, user);
    }
    expect(connectInstallation).toHaveBeenCalledExactlyOnceWith(third);
    expect(vi.mocked(selectInstallation).mock.calls).toEqual(
      originalRegistered ? [[origin], [third]] : [[origin]],
    );
    expect(inspect).toHaveBeenCalledOnce();
    expect(signInWithBrowser).not.toHaveBeenCalled();
  },
);
test("retries a failed protected-store read before offering an empty address", async () => {
  launch
    .mockRejectedValueOnce("credential_storage_unavailable")
    .mockResolvedValue({ status: "first_launch" });
  const view = render(<App language="en" />);
  await screen.findByRole("alert");
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("textbox", { name: "Server address" });
  expect(inspect).not.toHaveBeenCalled();
  view.unmount();
});
test("restored sign-in opens the saved list with one server and returns focus", async () => {
  launch.mockResolvedValue({
    status: "sign_in_required",
    serverUrl: origin,
    installations: [origin],
  });
  inspect.mockResolvedValue(profile);
  render(<App language="en" />);
  await screen.findByRole("heading", { name: "Sign in again" });
  expect(inspect.mock.calls[0][0]).toBe(origin);
  expect(connectInstallation).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Change server address" }),
  ).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Another server" }));
  expect(
    screen.getByRole("heading", { name: "Servers on this device" }),
  ).toBeTruthy();
  expect(screen.queryByText("Message link is waiting for sign-in")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add server" }));
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Add server" }),
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Another server" }),
  );
  expect(selectInstallation).not.toHaveBeenCalled();
  expect(inspect).toHaveBeenCalledOnce();
});
test("keeps the saved list open on a failed switch and reads the new installation after retry", async () => {
  const next = "https://chat.example.test/Other";
  const installations = [origin, next];
  launch
    .mockResolvedValueOnce({
      status: "sign_in_required",
      serverUrl: origin,
      installations,
    })
    .mockResolvedValue({
      status: "sign_in_required",
      serverUrl: next,
      installations,
    });
  inspect.mockImplementation(async (url) => ({ ...profile, serverUrl: url }));
  vi.mocked(selectInstallation)
    .mockRejectedValueOnce("fixture failure")
    .mockResolvedValueOnce();
  render(<App language="en" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Another server" }),
  );
  const destination = screen.getByRole("button", {
    name: /chat.example.test.*Other/,
  });
  fireEvent.click(destination);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Couldn’t switch servers.",
  );
  expect(inspect).toHaveBeenCalledOnce();
  fireEvent.click(destination);
  await screen.findByRole("heading", { name: "Sign in again" });
  expect(screen.getByTitle(next)).toBeTruthy();
  expect(inspect.mock.calls.map(([url]) => url)).toEqual([origin, next]);
  expect(connectInstallation).not.toHaveBeenCalled();
});
function BackOnFirstFrame() {
  useLayoutEffect(() => {
    screen.getByRole("button", { name: "Change server address" }).click();
  }, []);
  return null;
}

test("Back cancels a saved server even in the first visible frame", async () => {
  inspect.mockResolvedValue(profile);
  await act(async () => {
    render(
      <>
        <ServerSignIn
          connect={connectInstallation}
          savedServer={origin}
          language="en"
          onAccountChanged={vi.fn()}
        />
        <BackOnFirstFrame />
      </>,
    );
  });
  expect(inspect).toHaveBeenCalledOnce();
  expect(inspect.mock.calls[0][1]?.aborted).toBe(true);
  const field = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Server address",
  });
  expect(field.value).toBe(origin);
  expect(field.readOnly).toBe(false);
  expect(document.activeElement).toBe(field);
  expect(
    screen.queryByRole("button", { name: "Sign in with GitLab" }),
  ).toBeNull();
});

test("allows switching away from a slow saved server and ignores its delayed profile", async () => {
  launch.mockResolvedValue({
    status: "sign_in_required",
    serverUrl: origin,
    installations: [origin],
  });
  let finish!: (value: typeof profile) => void;
  inspect.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<App language="en" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Change server address" }),
  );
  expect(inspect.mock.calls[0][1]?.aborted).toBe(true);
  await act(async () => finish(profile));
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(origin);
  expect(screen.queryByRole("heading", { name: "Sign in again" })).toBeNull();
});
function offlineWorkspace() {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  launch.mockResolvedValue({
    status: "ready",
    serverUrl: origin,
    userId: user,
    installations: [origin],
  });
  const team = {
    id: "b".repeat(26),
    name: "winter",
    displayName: "Winter HQ",
    roles: "",
    preferenceRank: null,
  };
  const channelId = "c".repeat(26),
    otherId = "d".repeat(26);
  const channel = (id: string, name: string) => ({
    id,
    kind: "O",
    roles: id === channelId ? "writer" : "reader",
    name,
    displayName: name,
    header: "",
    purpose: "",
    createAt: 1,
    deleteAt: 0,
    muted: false,
    lastPostAt: 20,
    lastRootPostAt: null,
    lastViewedAt: 20,
    totalMsgCount: 1,
    totalMsgCountRoot: null,
    msgCount: 1,
    msgCountRoot: null,
    mentionCount: 0,
    mentionCountRoot: 0,
    urgentMentionCount: 0,
  });
  const rooms = [channel(channelId, "General"), channel(otherId, "Design")];
  const directIds: string[] = [];
  let selected = channelId;
  const connection = {
    readWorkspaceSettings: vi.fn().mockResolvedValue({
      preferences: {
        nameFormat: null,
        collapsedThreads: null,
        separateUnreads: null,
        limit: null,
        directShown: {},
        groupShown: {},
        viewTimes: {},
      },
      server: {
        collapsedThreads: "disabled",
        nameFormat: "username",
        lockNameFormat: false,
        separateUnreads: false,
      },
    }),
    refreshWorkspaceServerPolicy: vi.fn(),
    readTeamSidebar: vi.fn(async () => ({
      selectedChannel: selected,
      data: {
        channels: rooms,
        categories: [
          {
            id: "main",
            kind: "channels",
            displayName: "Channels",
            collapsed: false,
            muted: false,
            sorting: "manual",
            channelIds: [channelId, otherId],
          },
          {
            id: "direct-category",
            kind: "direct_messages",
            displayName: "Direct messages",
            collapsed: false,
            muted: false,
            sorting: "recent",
            channelIds: directIds,
          },
        ],
      },
    })),
    readConversationRecipients:
      vi.fn<
        Awaited<
          ReturnType<typeof openAccountRestConnection>
        >["readConversationRecipients"]
      >(),
    openRecipientConversation:
      vi.fn<
        Awaited<
          ReturnType<typeof openAccountRestConnection>
        >["openRecipientConversation"]
      >(),
    selectSidebarChannel: vi.fn(async (_team: string, id: string) => {
      selected = id;
      return true;
    }),
    refreshTeamSidebar: vi.fn(),
    readSavedTeamRoles: vi.fn().mockResolvedValue({
      systemRoles: "",
      definitions: [
        { name: "writer", permissions: ["create_post"] },
        { name: "reader", permissions: [] },
      ],
    }),
    refreshTeamRoles: vi.fn(),
    readDraft: vi.fn(async () => ({
      message: "Text saved on this device",
      revision: "saved",
    })),
    saveDraft: vi.fn(),
    submitDraft: vi.fn(),
    readPendingPosts: vi.fn(async ({ channelId: id }) =>
      id === channelId
        ? [
            {
              channelId: id,
              rootId: null,
              pendingId: "local-fixture",
              sequence: 1,
              createdAt: 8,
              message: "Offline outgoing in General",
              attempt: 1,
              refusal: null,
              confirmedPostId: null,
              files: [],
              previousLogin: false,
            },
          ]
        : [],
    ),
    subscribeToPostActivity: vi.fn(() => () => {}),
    subscribeToChannelHistory: vi.fn(() => () => {}),
    subscribeToSavedPostState: vi.fn(() => () => {}),
    getSavedPostPresentation: () => "loading",
    retireDeliveredPosts: vi.fn().mockResolvedValue(0),
    getOutgoingPostState: (post: PendingPost) =>
      outgoingRowState(post, false, false),
    readChannelWindow: vi.fn(async ({ channelId: id }) => ({
      posts: [
        {
          id,
          channelId: id,
          userId: user,
          createAt: 5,
          editAt: 0,
          isPinned: false,
          type: "",
          message: id === channelId ? "Saved in General" : "Saved in Design",
        },
      ],
      older: { kind: "end" },
      newer: { kind: "end" },
      firstInaccessiblePostTime: 0,
    })),
    refreshChannelHistory: vi.fn(),
    readSavedProfiles: vi.fn(
      async (_query: { ids: readonly string[] }): Promise<SavedProfiles> => ({
        profiles: {},
        usernames: {},
      }),
    ),
    refreshSavedProfiles: vi.fn(),
    readJoinedTeams: vi
      .fn()
      .mockResolvedValue({ teams: [team], selectedTeam: team.id }),
    reopenKnownConversation:
      vi.fn<
        (
          teamId: string,
          id: string,
          signal?: AbortSignal,
        ) => Promise<"confirmed" | "alreadyShown">
      >(),
    selectJoinedTeam: vi.fn().mockResolvedValue(true),
    refreshJoinedTeams: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(openAccountRestConnection).mockResolvedValue(
    connection as unknown as Awaited<
      ReturnType<typeof openAccountRestConnection>
    >,
  );
  return {
    team,
    channelId,
    otherId,
    connection,
    rooms,
    directIds,
    channel,
    get selected() {
      return selected;
    },
    set selected(id: string) {
      selected = id;
    },
  };
}

test("opens a hidden known conversation offline and returns to its draft selection through the quick switcher", async () => {
  const { team, channelId, channel, rooms, connection } = offlineWorkspace();
  const peer = "e".repeat(26),
    hiddenId = "f".repeat(26);
  rooms.push({
    ...channel(hiddenId, `${user}__${peer}`),
    kind: "D",
    displayName: "",
    lastViewedAt: 0,
  });
  const person = channelProfile({
    id: peer,
    username: "winter-owl",
    nickname: "Полярная сова",
  });
  connection.readSavedProfiles.mockImplementation(async ({ ids }) =>
    ids.includes(peer)
      ? { profiles: { [peer]: person }, usernames: {} }
      : { profiles: {}, usernames: {} },
  );
  render(<App language="en" />);
  const generalDraft = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #General…",
  });
  generalDraft.focus();
  generalDraft.setSelectionRange(2, 6, "backward");
  fireEvent.keyDown(generalDraft, { code: "KeyK", key: "л", ctrlKey: true });
  const firstField = await screen.findByRole("combobox");
  fireEvent.keyDown(firstField, {
    code: "KeyK",
    key: "л",
    ctrlKey: true,
    repeat: true,
  });
  expect(document.activeElement).toBe(firstField);
  fireEvent.keyDown(firstField, { code: "KeyK", key: "л", ctrlKey: true });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(generalDraft);
  fireEvent.keyDown(generalDraft, { code: "KeyK", key: "л", ctrlKey: true });
  const swift = within(
    await screen.findByRole("dialog", { name: "Find a channel" }),
  );
  const query = swift.getByRole("combobox");
  expect(document.activeElement).toBe(query);
  const initial = swift.getAllByRole("option");
  expect(initial[0].getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(query, { key: "ArrowUp" });
  expect(initial.at(-1)?.getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(query, { key: "ArrowDown" });
  expect(initial[0].getAttribute("aria-selected")).toBe("true");
  fireEvent.change(query, { target: { value: "@полярная" } });
  const hidden = await swift.findByRole("option", { name: /winter-owl/ });
  expect(query.getAttribute("aria-activedescendant")).toBe(hidden.id);
  const reads = connection.readSavedProfiles.mock.calls.length;
  fireEvent.change(query, { target: { value: "@winter" } });
  fireEvent.keyDown(query, { key: "Enter", isComposing: true });
  expect(connection.selectSidebarChannel).not.toHaveBeenCalled();
  expect(connection.readSavedProfiles).toHaveBeenCalledTimes(reads);
  fireEvent.keyDown(query, { key: "Enter" });
  await waitFor(() =>
    expect(connection.selectSidebarChannel).toHaveBeenLastCalledWith(
      team.id,
      hiddenId,
    ),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  await screen.findByRole("heading", { name: "winter-owl" });
  fireEvent.click(screen.getByRole("button", { name: "Find a channel" }));
  const again = within(
    await screen.findByRole("dialog", { name: "Find a channel" }),
  );
  fireEvent.change(again.getByRole("combobox"), {
    target: { value: "#general" },
  });
  const general = again.getByRole("option", { name: "General" });
  expect(general.querySelector("mark")?.textContent).toBe("General");
  fireEvent.click(general);
  const reopened = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #General…",
  });
  expect(reopened.value).toBe("Text saved on this device");
  expect([
    reopened.selectionStart,
    reopened.selectionEnd,
    reopened.selectionDirection,
  ]).toEqual([2, 6, "backward"]);
  expect(connection.selectSidebarChannel).toHaveBeenLastCalledWith(
    team.id,
    channelId,
  );
  const trigger = screen.getByRole("button", { name: "Find a channel" });
  trigger.focus();
  fireEvent.click(trigger);
  const popup = await screen.findByRole("dialog");
  const input = within(popup).getByRole("combobox");
  fireEvent.change(input, { target: { value: "definitely-no-such-room" } });
  expect(await within(popup).findByText("No conversations found")).toBeTruthy();
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(document.activeElement).toBe(trigger);
  expect(connection.refreshSavedProfiles).not.toHaveBeenCalled();
  expect(connection.refreshTeamSidebar).not.toHaveBeenCalled();
  expect(connection.reopenKnownConversation).not.toHaveBeenCalled();
});

async function openHiddenFromFinder(kind: "D" | "G") {
  const { team, channelId, rooms, directIds, channel, connection } =
    offlineWorkspace();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const id = "f".repeat(26),
    peer = "e".repeat(26);
  const rowTitle = kind === "D" ? "winter-owl" : "winter-owl, cloud";
  rooms.push({
    ...channel(id, kind === "D" ? `${user}__${peer}` : "group-key"),
    displayName: kind === "D" ? "" : rowTitle,
    kind,
    roles: "writer",
  });
  directIds.push(id);
  const saved = await connection.readWorkspaceSettings();
  const person = channelProfile({
    id: peer,
    username: "winter-owl",
    deleteAt: 0,
  });
  connection.readSavedProfiles.mockResolvedValue({
    profiles: { [peer]: person },
    usernames: { "winter-owl": peer },
  });
  connection.refreshJoinedTeams.mockResolvedValue(true);
  const view = render(<App language="en" />);
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #General…",
  });
  await waitFor(() => expect(connection.refreshJoinedTeams).toHaveBeenCalled());
  connection.refreshJoinedTeams.mockClear();
  const pick = async (term: string, title: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Find a channel" }));
    const popup = within(await screen.findByRole("dialog"));
    fireEvent.change(popup.getByRole("combobox"), { target: { value: term } });
    fireEvent.click(await popup.findByRole("option", { name: title }));
    await screen.findByRole("heading", { name: title });
  };
  return {
    team,
    channelId,
    id,
    peer,
    rowTitle,
    saved,
    field,
    connection,
    pick,
    unmount: view.unmount,
  };
}

test.each(["D", "G"] as const)(
  "returns hidden %s to the personal sidebar after choosing a different channel",
  async (kind) => {
    const { team, id, peer, rowTitle, saved, field, connection, pick } =
      await openHiddenFromFinder(kind);
    let confirm!: () => void;
    connection.reopenKnownConversation.mockImplementation(
      () =>
        new Promise((resolve) => {
          confirm = () => resolve("confirmed");
        }),
    );
    let publish!: () => void;
    connection.refreshJoinedTeams.mockImplementation(
      () =>
        new Promise((resolve) => {
          publish = () => {
            connection.readWorkspaceSettings.mockResolvedValue({
              ...saved,
              preferences: {
                ...saved.preferences,
                directShown: kind === "D" ? { [peer]: true } : {},
                groupShown: kind === "G" ? { [id]: true } : {},
              },
            });
            resolve(true);
          };
        }),
    );
    field.setSelectionRange(2, 5, "backward");
    expect(screen.queryByRole("button", { name: rowTitle })).toBeNull();
    await pick("winter-owl", rowTitle);
    await waitFor(() =>
      expect(connection.reopenKnownConversation).toHaveBeenCalledWith(
        team.id,
        id,
        expect.any(AbortSignal),
      ),
    );
    expect(connection.selectSidebarChannel).toHaveBeenCalledWith(team.id, id);
    await pick("#general", "General");
    expect(screen.queryByRole("button", { name: rowTitle })).toBeNull();
    await act(async () => confirm());
    expect(connection.refreshJoinedTeams).toHaveBeenCalledTimes(1);
    await act(async () => publish());
    await screen.findByRole("button", { name: rowTitle });
    const draft = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Message #General…",
    });
    expect(draft.value).toBe("Text saved on this device");
    expect([draft.selectionStart, draft.selectionEnd]).toEqual([2, 5]);
    await pick("winter-owl", rowTitle);
    await waitFor(() =>
      expect(connection.selectSidebarChannel).toHaveBeenCalledTimes(3),
    );
    expect(connection.reopenKnownConversation).toHaveBeenCalledTimes(1);
    expect(connection.saveDraft).not.toHaveBeenCalled();
  },
);

test.each(["D", "G"] as const)(
  "chooses %s again after a confirmed preference was hidden on another device",
  async (kind) => {
    const { team, id, peer, rowTitle, saved, connection, pick } =
      await openHiddenFromFinder(kind);
    let shownOnServer = false;
    connection.reopenKnownConversation.mockImplementation(async () => {
      shownOnServer = true;
      return "confirmed";
    });
    connection.refreshJoinedTeams
      .mockRejectedValueOnce("network")
      .mockImplementation(async () => {
        connection.readWorkspaceSettings.mockResolvedValue({
          ...saved,
          preferences: {
            ...saved.preferences,
            directShown: kind === "D" && shownOnServer ? { [peer]: true } : {},
            groupShown: kind === "G" && shownOnServer ? { [id]: true } : {},
          },
        });
        return true;
      });

    await pick("winter-owl", rowTitle);
    const failure =
      "The server saved your change. Couldn’t update the sidebar on this device.";
    await screen.findByText(failure);
    expect(shownOnServer).toBe(true);
    expect(connection.reopenKnownConversation).toHaveBeenCalledTimes(1);
    expect(connection.refreshJoinedTeams).toHaveBeenCalledTimes(1);

    await pick("#general", "General");
    shownOnServer = false;
    expect(screen.queryByRole("button", { name: rowTitle })).toBeNull();
    await pick("winter-owl", rowTitle);
    await waitFor(() =>
      expect(connection.reopenKnownConversation).toHaveBeenCalledTimes(2),
    );
    expect(connection.reopenKnownConversation).toHaveBeenLastCalledWith(
      team.id,
      id,
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(screen.queryByText(failure)).toBeNull());

    await pick("#general", "General");
    await screen.findByRole("button", { name: rowTitle });
    expect(shownOnServer).toBe(true);
    await pick("winter-owl", rowTitle);
    await waitFor(() =>
      expect(connection.selectSidebarChannel).toHaveBeenCalledTimes(5),
    );
    expect(connection.reopenKnownConversation).toHaveBeenCalledTimes(2);
    expect(connection.refreshJoinedTeams).toHaveBeenCalledTimes(2);
  },
);

test("retry after an unconfirmed write retries the PUT; confirmed write retries only publishing preferences", async () => {
  const { rowTitle, connection, pick, unmount } =
    await openHiddenFromFinder("D");
  connection.reopenKnownConversation
    .mockRejectedValueOnce("network")
    .mockResolvedValueOnce("confirmed");
  connection.refreshJoinedTeams.mockRejectedValueOnce("network");
  await pick("winter-owl", rowTitle);
  const writeError = await screen.findByText(
    "Couldn’t confirm that this conversation is visible on your other devices.",
  );
  expect(connection.reopenKnownConversation).toHaveBeenCalledTimes(1);
  expect(connection.refreshJoinedTeams).not.toHaveBeenCalled();
  fireEvent.click(
    within(writeError.parentElement as HTMLElement).getByRole("button", {
      name: "Try again",
    }),
  );
  const readError = await screen.findByText(
    "The server saved your change. Couldn’t update the sidebar on this device.",
  );
  expect(connection.reopenKnownConversation).toHaveBeenCalledTimes(2);
  let finish!: () => void;
  connection.refreshJoinedTeams.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(true);
      }),
  );
  const retryRead = within(readError.parentElement as HTMLElement).getByRole(
    "button",
    { name: "Try again" },
  );
  fireEvent.click(retryRead);
  fireEvent.click(retryRead);
  await waitFor(() =>
    expect(connection.refreshJoinedTeams).toHaveBeenCalledTimes(2),
  );
  const reads = connection.readWorkspaceSettings.mock.calls.length;
  const signal = connection.refreshJoinedTeams.mock
    .lastCall?.[0] as AbortSignal;
  unmount();
  expect(signal.aborted).toBe(true);
  const secondUser = "t".repeat(26);
  const second = offlineWorkspace().connection;
  launch.mockResolvedValue({
    status: "ready",
    serverUrl: origin,
    userId: secondUser,
    installations: [origin],
  });
  render(<App language="en" />);
  await screen.findByRole("heading", { name: "General" });
  expect(openAccountRestConnection).toHaveBeenLastCalledWith(
    origin,
    secondUser,
  );
  const secondReads = second.readWorkspaceSettings.mock.calls.length;
  await act(async () => finish());
  expect(connection.readWorkspaceSettings).toHaveBeenCalledTimes(reads);
  expect(connection.reopenKnownConversation).toHaveBeenCalledTimes(2);
  expect(second.readWorkspaceSettings).toHaveBeenCalledTimes(secondReads);
  expect(second.reopenKnownConversation).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: rowTitle })).toBeNull();
});

test("going offline while SQLite saves an explicit hidden choice does not enqueue a later PUT", async () => {
  const { rowTitle, connection, pick } = await openHiddenFromFinder("D");
  let finish!: () => void;
  connection.selectSidebarChannel.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(true);
      }),
  );
  await pick("winter-owl", rowTitle);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => finish());
  expect(connection.reopenKnownConversation).not.toHaveBeenCalled();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  fireEvent(window, new Event("online"));
  await waitFor(() => expect(connection.refreshJoinedTeams).toHaveBeenCalled());
  expect(connection.reopenKnownConversation).not.toHaveBeenCalled();
});

test("local selection failure cannot write personal visibility", async () => {
  const { rowTitle, connection, pick } = await openHiddenFromFinder("D");
  connection.selectSidebarChannel.mockResolvedValueOnce(false);
  await pick("winter-owl", rowTitle);
  await screen.findByText("Couldn’t save the selected channel.");
  expect(connection.reopenKnownConversation).not.toHaveBeenCalled();
});
test("keeps a typed quick-switch query when saved profile lookup fails", async () => {
  const { rooms, channel, connection } = offlineWorkspace();
  const peer = "e".repeat(26);
  rooms.push({
    ...channel("f".repeat(26), `${user}__${peer}`),
    kind: "D",
    displayName: "",
  });
  render(<App language="en" />);
  await screen.findByRole("textbox", { name: "Message #General…" });
  let fail!: (reason: string) => void;
  connection.readSavedProfiles.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Find a channel" }));
  const dialog = within(await screen.findByRole("dialog"));
  const field = dialog.getByRole<HTMLInputElement>("combobox");
  fireEvent.change(field, { target: { value: "winter-owl" } });
  expect(dialog.getByRole("status").textContent).toBe(
    "Loading saved conversations…",
  );
  await act(async () => fail("history_storage_unavailable"));
  expect(dialog.getByRole("alert").textContent).toBe(
    "Couldn’t read or save the data on this device.",
  );
  expect(dialog.queryByText("No conversations found")).toBeNull();
  expect(field.value).toBe("winter-owl");
  expect(document.activeElement).toBe(field);
  fireEvent.change(field, { target: { value: "gen" } });
  expect(dialog.getByRole("option", { name: "General" })).toBeTruthy();
  expect(connection.refreshSavedProfiles).not.toHaveBeenCalled();
});

test("a late profile read from the previous team does not replace the current quick-switch group", async () => {
  const { team, rooms, channel, connection } = offlineWorkspace();
  const peer = "e".repeat(26),
    hiddenId = "f".repeat(26);
  rooms.push({
    ...channel(hiddenId, `${user}__${peer}`),
    kind: "D",
    displayName: "",
    lastViewedAt: 0,
  });
  const otherTeam = {
    ...team,
    id: "s".repeat(26),
    name: "summer",
    displayName: "Summer HQ",
  };
  const joined = {
    teams: [team, otherTeam],
    selectedTeam: team.id,
  };
  connection.readJoinedTeams.mockImplementation(async () => ({ ...joined }));
  connection.selectJoinedTeam.mockImplementation(async (id: string) => {
    joined.selectedTeam = id;
    return true;
  });
  const pending: ((value: SavedProfiles) => void)[] = [];
  connection.readSavedProfiles.mockImplementation(async ({ ids }) =>
    ids.includes(peer)
      ? new Promise((resolve) => pending.push(resolve))
      : { profiles: {}, usernames: {} },
  );
  render(<App language="en" />);
  await screen.findByText("Saved in General");
  fireEvent.click(screen.getByRole("button", { name: "Find a channel" }));
  const first = within(await screen.findByRole("dialog"));
  await waitFor(() => expect(pending).toHaveLength(1));
  fireEvent.click(first.getByRole("button", { name: "Close" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Switch team, Winter HQ" }),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Summer HQ",
    }),
  );
  await screen.findByRole("button", { name: "Switch team, Summer HQ" });
  await screen.findByText("Saved in General");
  fireEvent.click(screen.getByRole("button", { name: "Find a channel" }));
  const second = within(await screen.findByRole("dialog"));
  const input = second.getByRole<HTMLInputElement>("combobox");
  fireEvent.change(input, { target: { value: "owl" } });
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(second.getByRole("status").textContent).toBe(
    "Loading saved conversations…",
  );
  const result = (username: string) => ({
    profiles: { [peer]: channelProfile({ id: peer, username }) },
    usernames: {},
  });
  await act(async () => pending[1](result("summer-owl")));
  await second.findByRole("option", { name: "summer-owl" });
  await act(async () => pending[0](result("winter-owl")));
  expect(
    second.getAllByRole("option").map((row) => row.getAttribute("aria-label")),
  ).toEqual(["summer-owl"]);
  expect(input.value).toBe("owl");
  expect(connection.selectSidebarChannel).not.toHaveBeenCalled();
});

test("restores the selected team, channel, messages and account actions without a network request", async () => {
  const fixture = offlineWorkspace();
  const { team, channelId, otherId, rooms, connection } = fixture;
  const view = render(<App language="en" />);
  await screen.findByText("Saved in General");
  const outgoing = (
    await screen.findByText("Offline outgoing in General")
  ).closest("article");
  expect(outgoing?.textContent).toContain("Delivery unconfirmed");
  expect(openAccountRestConnection).toHaveBeenCalledWith(origin, user);
  expect(screen.queryByRole("note")).toBeNull();
  expect(
    (
      await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Message #General…",
      })
    ).value,
  ).toBe("Text saved on this device");
  fireEvent.click(screen.getByRole("button", { name: "Design" }));
  await screen.findByText("Saved in Design");
  expect(screen.queryByText("Offline outgoing in General")).toBeNull();
  expect((await screen.findByRole("note")).textContent).toContain(
    "This channel is read-only.",
  );
  expect(connection.selectSidebarChannel).toHaveBeenCalledWith(
    team.id,
    otherId,
  );
  fireEvent.click(screen.getByRole("button", { name: "Account" }));
  await screen.findByRole("dialog");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close account menu" }));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Account" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Switch team, Winter HQ" }),
  );
  expect(
    screen.getByRole("button", {
      name: "Winter HQ",
      current: true,
    }),
  ).toBe(document.activeElement);
  fireEvent.click(screen.getByRole("button", { name: "Winter HQ" }));
  await screen.findByText("Saved in Design");
  expect(connection.selectJoinedTeam).not.toHaveBeenCalled();
  expect(connection.refreshTeamSidebar).not.toHaveBeenCalled();
  expect(connection.readSavedTeamRoles).toHaveBeenCalledWith(team.id);
  expect(connection.refreshTeamRoles).not.toHaveBeenCalled();
  expect(connection.refreshChannelHistory).not.toHaveBeenCalled();
  expect(connection.refreshSavedProfiles).not.toHaveBeenCalled();
  expect(connection.refreshWorkspaceServerPolicy).not.toHaveBeenCalled();
  rooms[1].deleteAt = 100;
  fireEvent.click(
    screen.getByRole("button", { name: "Switch team, Winter HQ" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Winter HQ" }));
  fireEvent.click(await screen.findByRole("button", { name: "Close channel" }));
  await screen.findByText("Saved in General");
  expect(screen.queryByRole("button", { name: "Design" })).toBeNull();
  expect(connection.selectSidebarChannel).toHaveBeenLastCalledWith(
    team.id,
    channelId,
  );
  // A joined direct conversation is not this team's default destination.
  rooms[0].kind = "D";
  fixture.selected = otherId;
  view.rerender(<App language="en" key="reopened" />);
  fireEvent.click(await screen.findByRole("button", { name: "Close channel" }));
  expect(
    await screen.findByRole("button", {
      name: "Winter HQ",
    }),
  ).toBeTruthy();
  expect(fixture.selected).toBe(otherId);
  view.unmount();
  expect(connection.close).toHaveBeenCalledTimes(2);
  expect(connection.refreshJoinedTeams).not.toHaveBeenCalled();
  expect(inspect).not.toHaveBeenCalled();
});
test("a failed explicit selection keeps the typed address available for retry", async () => {
  launch.mockResolvedValue({ status: "first_launch" });
  inspect.mockResolvedValue(profile);
  vi.mocked(connectInstallation).mockRejectedValue("registry_error");
  render(<App language="en" />);
  const input = await screen.findByRole<HTMLInputElement>("textbox", {
    name: "Server address",
  });
  fireEvent.change(input, { target: { value: origin } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "device’s account data",
  );
  expect(input.value).toBe(origin);
  expect(
    screen.queryByRole("button", { name: "Sign in with GitLab" }),
  ).toBeNull();
});

test("an explicit device selection completes before another address can be submitted", async () => {
  const next = "https://other.example.test/path";
  launch
    .mockResolvedValueOnce({
      status: "sign_in_required",
      serverUrl: origin,
      installations: [origin],
    })
    .mockResolvedValue({
      status: "sign_in_required",
      serverUrl: next,
      installations: [origin, next],
    });
  inspect
    .mockResolvedValueOnce(profile)
    .mockResolvedValueOnce({ ...profile, serverUrl: next, siteName: "Other" });
  let finish!: () => void;
  vi.mocked(connectInstallation).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<App language="en" />);
  await screen.findByRole("button", { name: "Sign in with GitLab" });
  fireEvent.click(screen.getByRole("button", { name: "Another server" }));
  fireEvent.click(screen.getByRole("button", { name: "Add server" }));
  const field = screen.getByRole<HTMLInputElement>("textbox");
  fireEvent.change(field, { target: { value: next } });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Continue" })),
  );
  expect(vi.mocked(connectInstallation).mock.calls).toEqual([[next]]);
  expect(
    screen.queryByRole("button", { name: "Back to saved servers" }),
  ).toBeNull();
  expect(field.readOnly).toBe(true);
  const form = field.form;
  if (!form) throw Error("Missing connection form");
  fireEvent.submit(form);
  expect(connectInstallation).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(document.activeElement).toBe(
    isMobile
      ? screen.getByRole("heading", { name: "How would you like to sign in?" })
      : screen.getByRole("button", { name: "Sign in with GitLab" }),
  );
  expect(screen.getByText("Other")).toBeTruthy();
  expect(screen.getByTitle(next)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(next);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(
    screen
      .getByRole("button", { name: /Other.*Selected/ })
      .getAttribute("aria-current"),
  ).toBe("true");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.getByRole("heading", { name: "Sign in again" })).toBeTruthy();
  expect(screen.getByTitle(next)).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Another server" }),
  );
  expect(selectInstallation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Another server" }));
  expect(
    screen
      .getByRole("button", { name: /Other.*Selected/ })
      .getAttribute("aria-current"),
  ).toBe("true");
});

test("pasted addresses distinguish exact saved channel names from IDs, online-only posts, neighboring teams and nested installations", async () => {
  const { rooms, channel, connection, channelId } = offlineWorkspace();
  const slug = "q".repeat(26),
    target = "w".repeat(26);
  const unsupported = origin + "/winter/messages/@somebody";
  rooms.push(
    { ...channel(target, slug), displayName: "Quiet room" },
    channel(slug, "other-slug"),
    { ...channel("z".repeat(26), "literal-address"), displayName: unsupported },
  );
  vi.mocked(listInstallations).mockResolvedValue([origin]);
  vi.mocked(getCurrentAccountId).mockResolvedValue(user);
  render(<App language="en" />);
  await screen.findByRole("heading", { name: "General" });
  const trigger = await screen.findByRole("button", { name: "Find a channel" });
  fireEvent.click(trigger);
  const dialog = within(
    await screen.findByRole("dialog", { name: "Find a channel" }),
  );
  const field = dialog.getByRole<HTMLInputElement>("combobox");
  const change = (address: string) =>
    fireEvent.change(field, { target: { value: address } });
  const enter = () => fireEvent.keyDown(field, { key: "Enter" });
  change(unsupported);
  enter();
  expect(dialog.queryByRole("option")).toBeNull();
  expect(connection.selectSidebarChannel).not.toHaveBeenCalled();
  change(origin + "/summer/channels/" + slug);
  expect(dialog.queryByRole("option")).toBeNull();
  change("https://another.example.test/winter/pl/" + target);
  expect(dialog.queryByRole("option")).toBeNull();
  expect(listInstallations).not.toHaveBeenCalled();
  const message = origin + "/winter/pl/" + target;
  change(message);
  enter();
  await dialog.findByText("Connect to the server to open this message.");
  expect(field.value).toBe(message);
  change(origin + "/winter/channels/unknown");
  enter();
  await dialog.findByText("This conversation isn’t saved in this team.");
  expect(connection.selectSidebarChannel).not.toHaveBeenCalled();
  vi.mocked(listInstallations).mockResolvedValueOnce([
    origin,
    origin + "/winter",
  ]);
  change(origin + "/winter/channels/" + slug);
  enter();
  await dialog.findByText("This address doesn’t belong to the current server.");
  expect(connection.selectSidebarChannel).not.toHaveBeenCalled();
  enter();
  await screen.findByRole("heading", { name: "Quiet room" });
  expect(connection.selectSidebarChannel).toHaveBeenCalledExactlyOnceWith(
    "b".repeat(26),
    target,
  );
  expect(connection.selectSidebarChannel).not.toHaveBeenCalledWith(
    "b".repeat(26),
    channelId,
  );
  expect(connection.refreshChannelHistory).not.toHaveBeenCalled();
});
test.each(["edit", "dismiss", "unmount"])(
  "a delayed pasted address cannot navigate after %s",
  async (action) => {
    const { connection } = offlineWorkspace();
    let complete!: (installs: string[]) => void;
    vi.mocked(listInstallations).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    vi.mocked(getCurrentAccountId).mockResolvedValue(user);
    const view = render(<App language="en" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Find a channel" }),
    );
    const field = screen.getByRole("combobox");
    fireEvent.change(field, {
      target: { value: origin + "/winter/channels/Design" },
    });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(listInstallations).toHaveBeenCalledTimes(1);
    if (action === "edit")
      fireEvent.change(field, { target: { value: "General" } });
    if (action === "dismiss") fireEvent.keyDown(field, { key: "Escape" });
    if (action === "unmount") view.unmount();
    await act(async () => complete([origin]));
    expect(connection.selectSidebarChannel).not.toHaveBeenCalled();
  },
);

test("opens a new direct conversation from the empty direct category and returns to the original draft", async () => {
  const { channelId, channel, rooms, directIds, team, connection } =
    offlineWorkspace();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const id = "h".repeat(26),
    peer = "m".repeat(26);
  const person = channelProfile({
    id: peer,
    username: "river-owl",
    deleteAt: 0,
  });
  connection.readSavedProfiles.mockResolvedValue({
    profiles: { [peer]: person },
    usernames: {},
  });
  connection.readConversationRecipients.mockResolvedValue({
    profiles: [person],
    nextPage: null,
  });
  connection.reopenKnownConversation.mockResolvedValue("alreadyShown");
  const settings = await connection.readWorkspaceSettings();
  connection.readWorkspaceSettings.mockResolvedValue({
    ...settings,
    preferences: { ...settings.preferences, directShown: { [peer]: true } },
  });
  let created = false;
  connection.openRecipientConversation.mockImplementation(async () => {
    created = true;
    return { kind: "applied", channelId: id, channelKind: "D" };
  });
  connection.refreshTeamSidebar.mockImplementation(async () => {
    if (created && !directIds.includes(id)) {
      rooms.push({
        ...channel(id, `${user}__${peer}`),
        kind: "D",
        displayName: "",
      });
      directIds.push(id);
    }
  });
  render(<App language="en" />);
  await screen.findByDisplayValue("Text saved on this device");
  const trigger = screen.getByLabelText("Direct message actions");
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: "Write a message" }));
  const first = within(
    await screen.findByRole("dialog", { name: "New direct message" }),
  );
  expect(document.activeElement).toBe(first.getByRole("searchbox"));
  fireEvent.keyDown(first.getByRole("searchbox"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: "Write a message" }));
  const picker = within(
    await screen.findByRole("dialog", { name: "New direct message" }),
  );
  fireEvent.change(picker.getByRole("searchbox"), {
    target: { value: "@river" },
  });
  fireEvent.click(await picker.findByRole("checkbox", { name: "river-owl" }));
  fireEvent.click(picker.getByRole("button", { name: "Open conversation" }));
  await screen.findByRole("heading", { name: "river-owl" });
  expect(connection.openRecipientConversation).toHaveBeenCalledExactlyOnceWith(
    [peer],
    expect.any(AbortSignal),
  );
  expect(connection.selectSidebarChannel).toHaveBeenCalledWith(team.id, id);
  fireEvent.click(screen.getByRole("button", { name: "General" }));
  const prior = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #General…",
  });
  await waitFor(() => expect(prior.value).toBe("Text saved on this device"));
  expect(connection.selectSidebarChannel).toHaveBeenLastCalledWith(
    team.id,
    channelId,
  );
  expect(connection.saveDraft).not.toHaveBeenCalled();
});
