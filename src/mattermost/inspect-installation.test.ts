import { beforeEach, expect, test, vi } from "vitest";
import {
  enteredServerUrl,
  InstallationAddressError,
  inspectInstallation,
} from "./inspect-installation";
import { loadInstallationProfile } from "./installation-profile";
import { openNativeRestConnection } from "./native-rest";

vi.mock("./native-rest", () => ({ openNativeRestConnection: vi.fn() }));
vi.mock("./installation-profile", () => ({ loadInstallationProfile: vi.fn() }));

const open = vi.mocked(openNativeRestConnection);
const read = vi.mocked(loadInstallationProfile);
const close = vi.fn<() => Promise<void>>();
const connection = {
  basePath: "https://chat",
  rid: 123,
  fetchApi: vi.fn<typeof fetch>(),
  close,
};
const profile: Awaited<ReturnType<typeof loadInstallationProfile>> = {
  version: "10.10.1",
  siteName: "Северное сияние",
  passwordIdentifiers: [],
  ssoProviders: ["gitlab"],
  guestMagicLink: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  open.mockResolvedValue(connection);
  read.mockResolvedValue(profile);
  close.mockResolvedValue(undefined);
});

test.each([
  [
    " Chat.example.org:443/Teams/Blue%20Sky//A%2FB/// ",
    "https://chat.example.org/Teams/Blue%20Sky//A%2FB",
  ],
  ["HTTPS://Chat", "https://chat"],
  ["mm:8443/root", "https://mm:8443/root"],
  ["[::1]:8443/mm", "https://[::1]:8443/mm"],
  ["127.0.0.1", "https://127.0.0.1"],
  ["пример.рф/команда", new URL("https://пример.рф/команда").href],
])("retains the HTTPS installation identified by %s", (input, expected) => {
  expect(enteredServerUrl(input)).toBe(expected);
});

test.each([
  [" ", "empty"],
  ["http://chat", "protocol"],
  ["http:/chat", "invalid"],
  ["https:/chat", "invalid"],
  ["ftp:/chat", "invalid"],
  ["https:/example.org:8443/path", "invalid"],
  ["https:443", "invalid"],
  ["chat.test:/path", "invalid"],
  ["https:///chat", "invalid"],
  ["ftp://chat.example", "protocol"],
  ["name:password@example.test/p", "extra-parts"],
  ["https://@chat.test", "extra-parts"],
  ["chat.test/p?", "extra-parts"],
  ["chat.test/p#", "extra-parts"],
  ["chat.test:70000", "invalid"],
  ["chat test", "invalid"],
  ["//unselected.test", "invalid"],
  ["chat.test\\other", "invalid"],
])("rejects %s before opening a native resource", async (input, issue) => {
  await expect(inspectInstallation(input)).rejects.toMatchObject({ issue });
  expect(() => enteredServerUrl(input)).toThrow(InstallationAddressError);
  expect(open).not.toHaveBeenCalled();
});

test("uses the native anonymous connection and closes it before returning advertised methods", async () => {
  const signal = new AbortController().signal;
  await expect(inspectInstallation("Chat", signal)).resolves.toEqual({
    serverUrl: "https://chat",
    ...profile,
  });
  expect(open).toHaveBeenCalledExactlyOnceWith("https://chat");
  expect(read).toHaveBeenCalledExactlyOnceWith(connection, signal);
  expect(close).toHaveBeenCalledOnce();
});
test("closing a rejected request preserves its original error", async () => {
  const serverError = new Error("HTTP 503");
  read.mockRejectedValue(serverError);
  close.mockRejectedValue(new Error("resource retired"));
  await expect(inspectInstallation("chat")).rejects.toBe(serverError);
  expect(close).toHaveBeenCalledOnce();
});
test("a failed cleanup after a successful read is reported", async () => {
  const failure = new Error("close");
  close.mockRejectedValue(failure);
  await expect(inspectInstallation("chat")).rejects.toBe(failure);
});
test.each(["before", "opening", "reading", "closing"] as const)(
  "cancels %s and retires each opened resource",
  async (phase) => {
    const controller = new AbortController();
    const reason = new Error("left form");
    if (phase === "before") controller.abort(reason);
    if (phase === "opening")
      open.mockImplementation(async () => {
        controller.abort(reason);
        return connection;
      });
    if (phase === "reading")
      read.mockImplementation(async () => {
        controller.abort(reason);
        throw new Error("transport canceled");
      });
    if (phase === "closing")
      close.mockImplementation(async () => {
        controller.abort(reason);
      });
    await expect(inspectInstallation("chat", controller.signal)).rejects.toBe(
      reason,
    );
    expect(close).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
    expect(read).toHaveBeenCalledTimes(
      phase === "reading" || phase === "closing" ? 1 : 0,
    );
  },
);
