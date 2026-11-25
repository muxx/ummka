import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";
import { getDeviceLaunchContext } from "./mattermost/device-launch";
import { inspectInstallation } from "./mattermost/inspect-installation";
import { connectInstallation } from "./mattermost/installation-registry";
import { openAccountRestConnection } from "./mattermost/native-rest";

vi.mock("./mattermost/device-launch", () => ({
  getDeviceLaunchContext: vi.fn(),
}));
vi.mock("./mattermost/installation-registry", () => ({
  connectInstallation: vi.fn(),
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
test("returns to saved sign-in without selecting a server again", async () => {
  launch.mockResolvedValue({ status: "sign_in_required", serverUrl: origin });
  inspect.mockResolvedValue(profile);
  render(<App language="en" />);
  await screen.findByRole("button", { name: "GitLab" });
  expect(inspect.mock.calls[0][0]).toBe(origin);
  expect(connectInstallation).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Change server address" }),
  );
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(origin);
});
test("allows switching away from a slow saved server and ignores its delayed profile", async () => {
  launch.mockResolvedValue({ status: "sign_in_required", serverUrl: origin });
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
  expect(screen.queryByRole("heading", { name: "Winter" })).toBeNull();
});
test("restores the actual chosen team before contacting the server", async () => {
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
    preferenceRank: null,
  };
  const connection = {
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
  expect(await screen.findByRole("heading", { name: "Winter HQ" })).toBe(
    document.activeElement,
  );
  expect(openAccountRestConnection).toHaveBeenCalledWith(origin, user);
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Switch team" }));
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
  expect(await screen.findByRole("heading", { name: "Winter HQ" })).toBe(
    document.activeElement,
  );
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
  expect(screen.queryByRole("button", { name: "GitLab" })).toBeNull();
});

test("an explicit device selection completes before another address can be submitted", async () => {
  const next = "https://other.example.test/path";
  launch
    .mockResolvedValueOnce({ status: "sign_in_required", serverUrl: origin })
    .mockResolvedValue({ status: "sign_in_required", serverUrl: next });
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
  await screen.findByRole("button", { name: "GitLab" });
  fireEvent.click(
    screen.getByRole("button", { name: "Change server address" }),
  );
  const field = screen.getByRole<HTMLInputElement>("textbox");
  fireEvent.change(field, { target: { value: next } });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Continue" })),
  );
  expect(vi.mocked(connectInstallation).mock.calls).toEqual([[next]]);
  expect(
    screen.queryByRole("button", { name: "Change server address" }),
  ).toBeNull();
  expect(field.readOnly).toBe(true);
  const form = field.form;
  if (!form) throw Error("Missing connection form");
  fireEvent.submit(form);
  expect(connectInstallation).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(screen.getByRole("heading", { name: "Other" })).toBe(
    document.activeElement,
  );
  expect(screen.getByText(next)).toBeTruthy();
});
