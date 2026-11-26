import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { AccountSignOut } from "../mattermost/native-rest";
import { AccountSessionWindow } from "./AccountSessionWindow";
import type { TeamWorkspace } from "./AccountTeamWindow";

import "../channels/workspace-dom.test-utils.ts";

afterEach(cleanup);
function fixture() {
  const signOut = vi.fn<() => Promise<AccountSignOut>>();
  const signOutOnDevice = vi.fn<() => Promise<"removed" | "superseded">>();
  const chooseAnotherTeam = vi.fn();
  const onEnded = vi.fn();
  const workspace: TeamWorkspace = {
    messages: {
      dialogOpen: false,
      open: vi.fn(),
      clear: vi.fn(),
      position: null,
      enqueue: (work) => work(),
    },
    serverUrl: "https://work.example.test/mattermost",
    userId: "a".repeat(26),
    directoryNotice: null,
    team: {
      id: "b".repeat(26),
      name: "core",
      displayName: "Core",
      preferenceRank: null,
    },
    chooseAnotherTeam,
    online: true,
    policy: {
      server: { status: "loading", value: null },
      user: null,
      userReadFailed: false,
      retry: () => {},
    },
    sessionIssue: () => {},
    connection: {
      rid: 17,
      signOut,
      signOutOnDevice,
    } as unknown as TeamWorkspace["connection"],
  };
  const view = render(
    <AccountSessionWindow
      workspace={workspace}
      language="en"
      onEnded={onEnded}
      onDismiss={() => {}}
    />,
  );
  return { signOut, signOutOnDevice, chooseAnotherTeam, onEnded, view };
}
function button(name: string) {
  return screen.getByRole("button", { name });
}
test.each(["signed_out", "superseded"] as const)(
  "finishes a %s result without local removal",
  async (status) => {
    const f = fixture();
    let finish!: (result: AccountSignOut) => void;
    f.signOut.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(button("Sign out"));
    fireEvent.click(button("Sign out"));
    expect(f.signOut).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("Signing out");
    await act(async () => finish({ status }));
    expect(f.onEnded).toHaveBeenCalledOnce();
    expect(f.signOutOnDevice).not.toHaveBeenCalled();
  },
);
test("an unconfirmed server response leaves the saved account available until explicit local consent", async () => {
  const f = fixture();
  f.signOut.mockResolvedValue({ status: "unconfirmed" });
  fireEvent.click(button("Sign out"));
  const stay = await screen.findByRole("button", { name: "Stay signed in" });
  expect(f.signOutOnDevice).not.toHaveBeenCalled();
  fireEvent.click(stay);
  expect(document.activeElement).toBe(button("Sign out"));
  fireEvent.click(button("Switch team"));
  expect(f.chooseAnotherTeam).toHaveBeenCalledOnce();
  fireEvent.click(button("Sign out"));
  const local = await screen.findByRole("button", {
    name: "Sign out only on this device",
  });
  f.signOutOnDevice
    .mockRejectedValueOnce("credential_storage_unavailable")
    .mockResolvedValueOnce("removed");
  fireEvent.click(local);
  await screen.findByRole("alert");
  expect(f.onEnded).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(local));
  expect(f.onEnded).toHaveBeenCalledOnce();
  expect(f.signOut).toHaveBeenCalledTimes(2);
});
test("confirmed remote logout retries only local cleanup and ignores a completion after switching accounts", async () => {
  const f = fixture();
  f.signOut.mockResolvedValue({
    status: "server_confirmed_local_removal_failed",
    cause: "private-storage-diagnostic",
  });
  fireEvent.click(button("Sign out"));
  const retry = await screen.findByRole("button", { name: "Retry removal" });
  expect(screen.queryByRole("button", { name: "Stay signed in" })).toBeNull();
  expect(document.body.textContent).not.toContain("private-storage-diagnostic");
  let finish!: (status: "superseded") => void;
  f.signOutOnDevice.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(f.signOutOnDevice).toHaveBeenCalledOnce();
  f.view.unmount();
  await act(async () => finish("superseded"));
  expect(f.onEnded).not.toHaveBeenCalled();
});
