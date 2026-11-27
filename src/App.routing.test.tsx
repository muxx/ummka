import "./empty-link-inbox.test-utils";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "./channels/workspace-dom.test-utils.ts";
import { App } from "./App";
import { isMobile } from "./build-platform";
import { ServerSignIn } from "./entry/ServerSignIn";
import type { PendingPost } from "./mattermost/account-delivery.ts";
import { getDeviceLaunchContext } from "./mattermost/device-launch";
import { inspectInstallation } from "./mattermost/inspect-installation";
import {
  connectInstallation,
  selectInstallation,
} from "./mattermost/installation-registry";
import { openAccountRestConnection } from "./mattermost/native-rest";
import { outgoingRowState } from "./mattermost/outgoing-row-state.ts";

vi.mock("./mattermost/device-launch", () => ({
  getDeviceLaunchContext: vi.fn(),
}));
vi.mock("./mattermost/installation-registry", () => ({
  connectInstallation: vi.fn(),
  selectInstallation: vi.fn(),
}));
vi.mock("./mattermost/native-rest", () => ({
  openAccountRestConnection: vi.fn(),
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
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
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
test("restores the selected team, channel, messages and account actions without a network request", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  launch.mockResolvedValue({
    status: "ready",
    serverUrl: origin,
    userId: user,
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
        ],
      },
    })),
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
              previousLogin: false,
            },
          ]
        : [],
    ),
    subscribeToPostActivity: vi.fn(() => () => {}),
    subscribeToChannelHistory: vi.fn(() => () => {}),
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
    readSavedProfiles: vi
      .fn()
      .mockResolvedValue({ profiles: {}, usernames: {} }),
    refreshSavedProfiles: vi.fn(),
    readJoinedTeams: vi
      .fn()
      .mockResolvedValue({ teams: [team], selectedTeam: team.id }),
    selectJoinedTeam: vi.fn().mockResolvedValue(true),
    refreshJoinedTeams: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(openAccountRestConnection).mockResolvedValue(
    connection as unknown as Awaited<
      ReturnType<typeof openAccountRestConnection>
    >,
  );
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
      description: "/winter",
      current: true,
    }),
  ).toBe(document.activeElement);
  fireEvent.click(
    screen.getByRole("button", { name: "Winter HQ", description: "/winter" }),
  );
  await screen.findByText("Saved in Design");
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
  fireEvent.click(
    screen.getByRole("button", { name: "Winter HQ", description: "/winter" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Close channel" }));
  await screen.findByText("Saved in General");
  expect(screen.queryByRole("button", { name: "Design" })).toBeNull();
  expect(connection.selectSidebarChannel).toHaveBeenLastCalledWith(
    team.id,
    channelId,
  );
  // A joined direct conversation is not this team's default destination.
  rooms[0].kind = "D";
  selected = otherId;
  fireEvent.click(
    screen.getByRole("button", { name: "Switch team, Winter HQ" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Winter HQ", description: "/winter" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Close channel" }));
  expect(
    await screen.findByRole("button", {
      name: "Winter HQ",
      description: "/winter",
    }),
  ).toBeTruthy();
  expect(selected).toBe(otherId);
  view.unmount();
  expect(connection.close).toHaveBeenCalledOnce();
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
