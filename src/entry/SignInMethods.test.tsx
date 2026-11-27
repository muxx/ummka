import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cancelBrowserSignIn,
  signInWithBrowser,
} from "../mattermost/browser-sign-in";
import { SignInMethods } from "./SignInMethods";

vi.mock("../mattermost/browser-sign-in", () => ({
  cancelBrowserSignIn: vi.fn(),
  signInWithBrowser: vi.fn(),
}));
const signIn = vi.mocked(signInWithBrowser);
const cancel = vi.mocked(cancelBrowserSignIn);
const profile = {
  version: "10.10.1",
  serverUrl: "https://chat.example.test/work",
  siteName: "Test server",
  passwordIdentifiers: [],
  guestMagicLink: false,
  ssoProviders: ["gitlab" as const, "google" as const],
};
const changed = vi.fn();
function mount() {
  return render(
    <SignInMethods
      language="en"
      profile={profile}
      onAccountChanged={changed}
      onBack={vi.fn()}
    />,
  );
}
beforeEach(() => {
  signIn.mockReset();
  cancel.mockReset().mockResolvedValue(true);
  changed.mockReset();
});
afterEach(cleanup);
test("opens a server-advertised provider and rereads the account after success", async () => {
  signIn.mockResolvedValue("a".repeat(26));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "GitLab" }));
  expect(signIn).toHaveBeenCalledWith(
    profile.serverUrl,
    "gitlab",
    expect.any(Function),
  );
  await waitFor(() =>
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      serverUrl: profile.serverUrl,
      siteName: profile.siteName,
      userId: "a".repeat(26),
    }),
  );
});
test("cancels once after receiving the native request ID and restores keyboard focus", async () => {
  let reject!: (reason: unknown) => void;
  signIn.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Google" }));
  const heading = screen.getByRole("heading", {
    name: "Continue in your browser",
  });
  expect(document.activeElement).toBe(heading);
  expect(screen.getByTitle(profile.serverUrl).textContent).toBe(
    "chat.example.test/work",
  );
  const button = screen
    .getAllByRole("button", { name: "Cancel sign-in" })
    .at(-1);
  if (!button) throw Error("Missing cancel control");
  fireEvent.click(button);
  fireEvent.click(button);
  expect(cancel).not.toHaveBeenCalled();
  await act(async () => signIn.mock.calls[0][2]("second-request"));
  expect(cancel.mock.calls).toEqual([["second-request"]]);
  await act(async () => reject({ kind: "browser", cause: "cancelled" }));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Google" }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
});
test.each([
  [{ kind: "browser", cause: "unsupported" }, "supports secure sign-in"],
  [{ kind: "browser", cause: "unavailable" }, "open the system browser"],
  [{ kind: "browser", cause: "busy" }, "in progress"],
  [{ kind: "not_saved", revocation_confirmed: false }, "hasn’t confirmed"],
  [{ kind: "not_saved", revocation_confirmed: true }, "session was closed"],
  [
    { kind: "invalid_response", detail: "private diagnostic" },
    "verify the sign-in",
  ],
  [
    {
      kind: "server",
      error: { message: "User-visible message", detail: "private diagnostic" },
    },
    "User-visible message",
  ],
] as const)("describes a native rejection", async (error, message) => {
  signIn.mockRejectedValue(error);
  mount();
  fireEvent.click(screen.getByRole("button", { name: "GitLab" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(message);
  expect(alert.textContent).not.toContain("private diagnostic");
  expect(changed).not.toHaveBeenCalled();
});
test("a different device selection returns to current context", async () => {
  signIn.mockRejectedValue({ kind: "selection_changed" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "GitLab" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
});
test("closing the window before the native reservation cancels only the old dialog", async () => {
  let finish!: (user: string) => void;
  signIn.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "GitLab" }));
  view.unmount();
  await act(async () => {
    signIn.mock.calls[0][2]("old-request");
    finish("old-user");
  });
  expect(cancel.mock.calls).toEqual([["old-request"]]);
  expect(changed).not.toHaveBeenCalled();
});
