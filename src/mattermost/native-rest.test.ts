import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, expectTypeOf, test, vi } from "vitest";
import {
  forgetLocalAccount,
  getCurrentAccountId,
  listAccountIds,
  openAccountRestConnection,
  openNativeRestConnection,
} from "./native-rest.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const ipc = vi.mocked(invoke);
beforeEach(() => ipc.mockReset());

const localQuery = {
  kind: "latest",
  channelId: "c".repeat(26),
  collapsedThreads: true,
  limit: 20,
} as const;

test("a local read uses only this account's native resource and keeps an unknown window distinct", async () => {
  ipc.mockResolvedValueOnce(27);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    "a".repeat(26),
  );
  ipc.mockResolvedValueOnce(null);
  await expect(account.readChannelWindow(localQuery)).resolves.toBeNull();
  expect(ipc).toHaveBeenLastCalledWith("read_channel_window", {
    rid: 27,
    query: localQuery,
  });
  ipc.mockRejectedValueOnce("history_storage_unavailable");
  await expect(account.readChannelWindow(localQuery)).rejects.toBe(
    "history_storage_unavailable",
  );
  ipc.mockResolvedValueOnce({ status: "unconfirmed" });
  await account.signOut();
  const empty = {
    posts: [],
    newer: { kind: "end" },
    older: { kind: "end" },
    firstInaccessiblePostTime: 0,
  };
  ipc.mockResolvedValueOnce(empty);
  await expect(account.readChannelWindow(localQuery)).resolves.toEqual(empty);
});

test.each(["close", "signOut", "signOutOnDevice"] as const)(
  "%s discards native results that were already in transit to the renderer",
  async (operation) => {
    ipc.mockResolvedValueOnce(41);
    const account = await openAccountRestConnection(
      "https://chat.example.test",
      "a".repeat(26),
    );
    let finish!: (value: unknown) => void;
    ipc.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const read = account.readChannelWindow(localQuery);
    ipc.mockResolvedValueOnce(
      operation === "signOut" ? { status: "signed_out" } : "removed",
    );
    await account[operation]();
    finish({ posts: [] });
    await expect(read).rejects.toBe("cancelled");
    await expect(account.readChannelWindow(localQuery)).rejects.toBe(
      operation === "close" ? "unknown_connection" : "cancelled",
    );
    expect(ipc).toHaveBeenCalledTimes(3);
  },
);

test("lists and forgets accounts for the exact canonical installation", async () => {
  const server = "https://CHAT.example.test/Team///";
  const serverUrl = "https://chat.example.test/Team";
  const userId = "Abc01234567890123456789012";
  ipc
    .mockResolvedValueOnce([userId])
    .mockRejectedValueOnce("credential_storage_unavailable");
  await expect(listAccountIds(server)).resolves.toEqual([userId]);
  await expect(forgetLocalAccount(server, userId)).rejects.toBe(
    "credential_storage_unavailable",
  );
  expect(ipc.mock.calls).toEqual([
    ["list_account_ids", { serverUrl }],
    ["forget_local_account", { serverUrl, userId }],
  ]);
});

test("observes the current user without opening a connection", async () => {
  const input = "https://CHAT.example.test/Team///";
  const serverUrl = "https://chat.example.test/Team";
  const id = "Abc01234567890123456789012";
  expectTypeOf(getCurrentAccountId).returns.toEqualTypeOf<
    Promise<string | null>
  >();
  ipc
    .mockResolvedValueOnce(id)
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce("installation_account_conflict");
  await expect(getCurrentAccountId(input)).resolves.toBe(id);
  await expect(getCurrentAccountId(input)).resolves.toBeNull();
  await expect(getCurrentAccountId(input)).rejects.toBe(
    "installation_account_conflict",
  );
  await expect(getCurrentAccountId("relative")).rejects.toThrow(TypeError);
  expect(ipc.mock.calls).toEqual(
    Array(3).fill(["get_current_account_id", { serverUrl }]),
  );
});

test("passes the canonical installation and closes the exact native handle", async () => {
  ipc.mockResolvedValueOnce(41).mockResolvedValueOnce(undefined);
  const connection = await openNativeRestConnection(
    " HTTPS://CHAT.example.test:8443/Teams/Blue%20Sky/// ",
  );
  const basePath = "https://chat.example.test:8443/Teams/Blue%20Sky";
  expect(connection.basePath).toBe(basePath);
  expect(connection.rid).toBe(41);
  expect(ipc).toHaveBeenNthCalledWith(1, "open_rest_connection", { basePath });
  expect("signOut" in connection).toBe(false);
  expect("readChannelWindow" in connection).toBe(false);
  expect("refreshChannelHistory" in connection).toBe(false);
  await connection.close();
  expect(ipc).toHaveBeenNthCalledWith(2, "close_rest_connection", { rid: 41 });
  expect(ipc).toHaveBeenCalledTimes(2);
});

test("rejects an invalid address before invoking Tauri", async () => {
  await expect(openNativeRestConnection("relative")).rejects.toThrow(TypeError);
  expect(ipc).not.toHaveBeenCalled();
});

test("opens a native account by installation and user ID", async () => {
  const userId = "Abc01234567890123456789012";
  ipc.mockResolvedValueOnce(9);
  const connection = await openAccountRestConnection(
    "https://CHAT.example.test/Team///",
    userId,
  );
  expect(ipc).toHaveBeenCalledWith("open_rest_connection", {
    basePath: "https://chat.example.test/Team",
    userId,
  });
  expect(Object.keys(connection).sort()).toEqual([
    "basePath",
    "close",
    "fetchApi",
    "readChannelWindow",
    "refreshChannelHistory",
    "rid",
    "signOut",
    "signOutOnDevice",
  ]);
});

test("only an explicit local sign-out sends the device command", async () => {
  ipc
    .mockResolvedValueOnce(27)
    .mockResolvedValueOnce({ status: "unconfirmed" });
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    "a".repeat(26),
  );
  expect(await account.signOut()).toEqual({ status: "unconfirmed" });
  expect(ipc).toHaveBeenCalledTimes(2);
  ipc.mockResolvedValueOnce("removed");
  expect(await account.signOutOnDevice()).toBe("removed");
  expect(ipc.mock.calls.slice(1)).toEqual([
    ["sign_out_account", { rid: 27 }],
    ["sign_out_on_device", { rid: 27 }],
  ]);
});

test("an absent account ID cannot open an anonymous connection", async () => {
  await expect(
    Reflect.apply(openAccountRestConnection, undefined, [
      "https://chat.example.test",
    ]),
  ).rejects.toThrow(TypeError);
  expect(ipc).not.toHaveBeenCalled();
});

test("preserves native errors from open and close", async () => {
  ipc.mockRejectedValueOnce("network");
  await expect(
    openNativeRestConnection("https://chat.example.test"),
  ).rejects.toBe("network");
  ipc.mockResolvedValueOnce(7).mockRejectedValueOnce("unknown_connection");
  const connection = await openNativeRestConnection(
    "https://chat.example.test",
  );
  await expect(connection.close()).rejects.toBe("unknown_connection");
});
