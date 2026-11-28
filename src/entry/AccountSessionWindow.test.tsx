import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import {
  type AccountSignOut,
  openAccountRestConnection,
} from "../mattermost/native-rest";
import { AccountSessionWindow } from "./AccountSessionWindow";
import { AccountTeamWindow, type TeamWorkspace } from "./AccountTeamWindow";

import "../channels/workspace-dom.test-utils.ts";

vi.mock("../mattermost/native-rest", () => ({
  openAccountRestConnection: vi.fn(),
}));

afterEach(cleanup);
const serverUrl = "https://work.example.test/mattermost";
const userId = "a".repeat(26);
const team = {
  id: "b".repeat(26),
  name: "core",
  displayName: "Core",
  preferenceRank: null,
};
function Avatar({ workspace }: { workspace: TeamWorkspace }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Account
      </button>
      {open && (
        <AccountSessionWindow
          workspace={workspace}
          language="en"
          accountName="Anna North"
          address="work.example.test/mattermost"
          onTeamChoice={() => {}}
          onDismiss={() => setOpen(false)}
        />
      )}
    </>
  );
}
async function fixture() {
  const signOut = vi.fn<() => Promise<AccountSignOut>>();
  const signOutOnDevice = vi.fn<() => Promise<"removed" | "superseded">>();
  const refreshJoinedTeams = vi.fn().mockResolvedValue(true);
  const onEnded = vi.fn();
  const connection = {
    rid: 17,
    signOut,
    signOutOnDevice,
    readJoinedTeams: async () => ({ teams: [team], selectedTeam: team.id }),
    readWorkspaceSettings: async () => ({ server: null, preferences: null }),
    refreshJoinedTeams,
    refreshWorkspaceServerPolicy: async () => true,
    close: async () => {},
  } as unknown as TeamWorkspace["connection"];
  vi.mocked(openAccountRestConnection).mockResolvedValue(connection);
  let sessionIssue!: TeamWorkspace["sessionIssue"];
  const view = render(
    <AccountTeamWindow
      threadReads={createThreadReadCoordination()}
      serverUrl={serverUrl}
      userId={userId}
      language="en"
      onSessionEnded={onEnded}
    >
      {(workspace) => {
        sessionIssue = workspace.sessionIssue;
        return <Avatar workspace={workspace} />;
      }}
    </AccountTeamWindow>,
  );
  await screen.findByRole("button", { name: "Account" });
  return {
    signOut,
    signOutOnDevice,
    refreshJoinedTeams,
    onEnded,
    view,
    sessionIssue: (issue: Parameters<TeamWorkspace["sessionIssue"]>[0]) =>
      sessionIssue(issue),
  };
}
function button(name: string) {
  return screen.getByRole("button", { name });
}
function openSignOut() {
  fireEvent.click(button("Account"));
  fireEvent.click(button("Sign out"));
}
function approve() {
  openSignOut();
  fireEvent.click(button("Sign out"));
}
function cancelDialog() {
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
}
test("the first click only asks for permission and both dismissal actions make no calls", async () => {
  const f = await fixture();
  openSignOut();
  const confirm = screen.getByRole("dialog", {
    name: "Sign out of this account?",
  });
  expect(confirm.textContent).toContain("Anna North");
  expect(confirm.textContent).toContain(serverUrl);
  expect(confirm.textContent).toContain("messages and drafts will be removed");
  expect(document.activeElement).toBe(button("Cancel"));
  expect(f.signOut).not.toHaveBeenCalled();
  fireEvent.click(button("Cancel"));
  expect(screen.queryByRole("dialog")).toBeNull();
  openSignOut();
  cancelDialog();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(f.signOut).not.toHaveBeenCalled();
  expect(f.signOutOnDevice).not.toHaveBeenCalled();
});

test.each(["signed_out", "superseded"] as const)(
  "finishes a %s result without local removal",
  async (status) => {
    const f = await fixture();
    let finish!: (result: AccountSignOut) => void;
    f.signOut.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    approve();
    const working = button("Signing out…");
    expect(working.getAttribute("aria-disabled")).toBe("true");
    expect(button("Cancel")).toHaveProperty("disabled", true);
    expect(button("Close")).toHaveProperty("disabled", true);
    fireEvent.click(working);
    cancelDialog();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(f.signOut).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toBe(
      "Ending the session on the server",
    );
    await act(async () => finish({ status }));
    expect(f.onEnded).toHaveBeenCalledOnce();
    expect(f.signOutOnDevice).not.toHaveBeenCalled();
  },
);

test("an unconfirmed result permits dismissal or local consent and a failed cleanup can be retried", async () => {
  const f = await fixture();
  f.signOut.mockResolvedValue({ status: "unconfirmed" });
  approve();
  const stay = await screen.findByRole("button", { name: "Stay signed in" });
  const explanation = screen.getByRole("region");
  expect(explanation.tabIndex).toBe(0);
  expect(explanation.contains(stay)).toBe(false);
  expect(document.activeElement).toBe(stay);
  fireEvent.click(stay);
  expect(screen.queryByRole("dialog")).toBeNull();
  approve();
  await screen.findByRole("button", { name: "Stay signed in" });
  cancelDialog();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(f.signOutOnDevice).not.toHaveBeenCalled();

  approve();
  const local = await screen.findByRole("button", {
    name: "Sign out only on this device",
  });
  f.signOutOnDevice
    .mockRejectedValueOnce("credential_storage_unavailable")
    .mockResolvedValueOnce("removed");
  fireEvent.click(local);
  const retry = await screen.findByRole("button", { name: "Retry cleanup" });
  expect(
    screen.getByText("Error code: credential_storage_unavailable"),
  ).toBeTruthy();
  expect(screen.queryByText(/server confirmed sign-out/)).toBeNull();
  expect(document.activeElement).toBe(retry);
  expect(f.onEnded).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(retry));
  expect(f.onEnded).toHaveBeenCalledOnce();
  expect(f.signOut).toHaveBeenCalledTimes(3);
  expect(f.signOutOnDevice).toHaveBeenCalledTimes(2);
});

test("confirmed cleanup remains available after Later despite other session errors", async () => {
  const f = await fixture();
  let finish!: (result: AccountSignOut) => void;
  f.signOut.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  approve();
  act(() => f.sessionIssue("unauthorized"));
  expect(f.signOutOnDevice).not.toHaveBeenCalled();
  await act(async () =>
    finish({
      status: "server_confirmed_local_removal_failed",
      cause: "history_storage_unavailable",
    }),
  );
  const initialRetry = button("Retry cleanup");
  expect(document.activeElement).toBe(initialRetry);
  expect(
    screen.getByText("Error code: history_storage_unavailable"),
  ).toBeTruthy();
  expect(screen.getByText(/server confirmed sign-out/)).toBeTruthy();
  fireEvent.click(button("Later"));
  const refreshes = f.refreshJoinedTeams.mock.calls.length;
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    f.sessionIssue("session");
  });
  expect(f.refreshJoinedTeams).toHaveBeenCalledTimes(refreshes);
  expect(f.onEnded).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();

  openSignOut();
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  const cleanupWindow = screen.getByRole("dialog", {
    name: "Account data is still on this device",
  });
  const retry = within(cleanupWindow).getByRole("button", {
    name: "Retry cleanup",
  });
  f.signOutOnDevice
    .mockRejectedValueOnce("private-storage-diagnostic")
    .mockResolvedValueOnce("removed");
  await act(async () => fireEvent.click(retry));
  expect(cleanupWindow.textContent).not.toContain("private-storage-diagnostic");
  fireEvent.click(button("Later"));
  openSignOut();
  await act(async () => fireEvent.click(button("Retry cleanup")));
  expect(f.signOut).toHaveBeenCalledOnce();
  expect(f.signOutOnDevice).toHaveBeenCalledTimes(2);
  expect(f.onEnded).toHaveBeenCalledOnce();
});

test("a cleanup completion after the account is gone cannot end a replacement", async () => {
  const f = await fixture();
  f.signOut.mockResolvedValue({
    status: "server_confirmed_local_removal_failed",
    cause: "credential_storage_unavailable",
  });
  approve();
  const retry = await screen.findByRole("button", { name: "Retry cleanup" });
  let finish!: (status: "superseded") => void;
  f.signOutOnDevice.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(retry);
  fireEvent.click(button("Cleaning up…"));
  expect(f.signOutOnDevice).toHaveBeenCalledOnce();
  f.view.unmount();
  await act(async () => finish("superseded"));
  expect(f.onEnded).not.toHaveBeenCalled();
});

import { createThreadReadCoordination } from "../mattermost/thread-read-coordination.ts";
