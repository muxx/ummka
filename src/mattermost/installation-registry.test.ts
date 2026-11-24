import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, test, vi } from "vitest";
import {
  forgetInstallation,
  listInstallations,
  readInstallationSelection,
  rememberInstallation,
  selectInstallation,
} from "./installation-registry.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const ipc = vi.mocked(invoke);
beforeEach(() => ipc.mockReset());

test("returns the host's ordered addresses through a single local call", async () => {
  const urls = ["https://chat.example.test", "https://chat.example.test/Team"];
  ipc.mockResolvedValueOnce(urls);
  expect(await listInstallations()).toEqual(urls);
  expect(ipc).toHaveBeenCalledExactlyOnceWith("list_installations");
});

test.each([
  ["select_installation", selectInstallation],
  ["remember_installation", rememberInstallation],
  ["forget_installation", forgetInstallation],
] as const)("%s sends only the canonical address", async (command, change) => {
  await change(" HTTPS://CHAT.example.test:443/Team/// ");
  expect(ipc).toHaveBeenCalledExactlyOnceWith(command, {
    serverUrl: "https://chat.example.test/Team",
  });
  ipc.mockClear();
  await expect(
    change("https://private-marker@chat.example.test"),
  ).rejects.toThrow(new TypeError("Invalid Mattermost server URL"));
  expect(ipc).not.toHaveBeenCalled();
});

test("preserves the host's error codes", async () => {
  ipc
    .mockRejectedValueOnce("unsupported_schema")
    .mockRejectedValueOnce("storage")
    .mockRejectedValueOnce("invalid_installation");
  await expect(listInstallations()).rejects.toBe("unsupported_schema");
  await expect(rememberInstallation("https://chat.example.test")).rejects.toBe(
    "storage",
  );
  await expect(forgetInstallation("https://chat.example.test")).rejects.toBe(
    "invalid_installation",
  );
});

test("returns one persisted installation snapshot", async () => {
  const selected = "https://chat.example.test/team";
  const snapshot = {
    installations: ["https://chat.example.test", selected],
    selected,
  };
  ipc.mockResolvedValueOnce(snapshot);
  await expect(readInstallationSelection()).resolves.toEqual(snapshot);
  expect(ipc).toHaveBeenCalledExactlyOnceWith("read_installation_selection");
});
