import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, expectTypeOf, test, vi } from "vitest";
import { channelProfile } from "./channel-profiles.ts";
import {
  forgetLocalAccount,
  getCurrentAccountId,
  listAccountIds,
  openAccountRestConnection,
  openNativeRestConnection,
} from "./native-rest.ts";
import * as directory from "./navigation-data.ts";
import * as profiles from "./visible-profiles.ts";

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

test("does not deliver an already received profile batch to a replaced connection", async () => {
  ipc.mockResolvedValueOnce(41);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    "u".repeat(26),
  );
  let complete!: () => void;
  const fetch = vi.spyOn(profiles, "loadVisibleProfiles").mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = () => resolve([]);
      }),
  );
  try {
    const query = { ids: ["p".repeat(26)], usernames: [] };
    const pending = account.readVisibleProfiles(query);
    ipc.mockResolvedValueOnce(undefined);
    await account.close();
    complete();
    await expect(pending).rejects.toBe("cancelled");
    await expect(account.readVisibleProfiles(query)).rejects.toBe(
      "unknown_connection",
    );
    expect(fetch).toHaveBeenCalledOnce();
  } finally {
    fetch.mockRestore();
  }
});

test("reads only the saved profile query, preserving native storage errors", async () => {
  ipc.mockResolvedValueOnce(9);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    "u".repeat(26),
  );
  const query = { ids: ["a".repeat(26)], usernames: ["ann"] };
  const saved = { profiles: {}, usernames: {} };
  ipc.mockResolvedValueOnce(saved);
  expect(await account.readSavedProfiles(query)).toBe(saved);
  expect(ipc).toHaveBeenLastCalledWith("read_saved_profiles", {
    rid: 9,
    query,
  });
  ipc.mockRejectedValueOnce("history_storage_unavailable");
  await expect(account.readSavedProfiles(query)).rejects.toBe(
    "history_storage_unavailable",
  );
});

test.each(["failure", "abort", "close"] as const)(
  "does not publish a late or incomplete profile read after %s",
  async (outcome) => {
    ipc.mockResolvedValueOnce(9);
    const account = await openAccountRestConnection(
      "https://chat.example.test",
      "u".repeat(26),
    );
    const controller = new AbortController();
    const reason = new Error("read stopped");
    let done!: () => void;
    const load = vi.spyOn(profiles, "loadVisibleProfiles").mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          done = () =>
            outcome === "failure"
              ? reject(reason)
              : resolve([
                  channelProfile({ id: "a".repeat(26), username: "ann" }),
                ]);
        }),
    );
    try {
      const refresh = account.refreshSavedProfiles(
        { ids: ["a".repeat(26)], usernames: [] },
        controller.signal,
      );
      if (outcome === "abort") controller.abort(reason);
      if (outcome === "close") {
        ipc.mockResolvedValueOnce(undefined);
        await account.close();
      }
      done();
      await expect(refresh).rejects.toBe(
        outcome === "close" ? "cancelled" : reason,
      );
      expect(
        ipc.mock.calls.some(([name]) => name === "store_channel_profiles"),
      ).toBe(false);
    } finally {
      load.mockRestore();
    }
  },
);

test("reports a native write failure and cancellation after a committed profile write", async () => {
  ipc.mockResolvedValueOnce(9);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    "u".repeat(26),
  );
  const record = channelProfile({ id: "a".repeat(26), username: "ann" });
  const query = { ids: [record.id], usernames: [] };
  const load = vi
    .spyOn(profiles, "loadVisibleProfiles")
    .mockResolvedValue([record]);
  try {
    ipc.mockRejectedValueOnce("history_storage_unavailable");
    await expect(account.refreshSavedProfiles(query)).rejects.toBe(
      "history_storage_unavailable",
    );
    const controller = new AbortController();
    const reason = new Error("navigation ended");
    ipc.mockImplementationOnce(async () => {
      controller.abort(reason);
    });
    await expect(
      account.refreshSavedProfiles(query, controller.signal),
    ).rejects.toBe(reason);
    expect(ipc).toHaveBeenLastCalledWith("store_channel_profiles", {
      rid: 9,
      profiles: [record],
    });
  } finally {
    load.mockRestore();
  }
});

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
  expect("readAccountDirectory" in connection).toBe(false);
  expect("readTeamDirectory" in connection).toBe(false);
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
    "readAccountDirectory",
    "readChannelWindow",
    "readJoinedTeams",
    "readSavedProfiles",
    "readTeamDirectory",
    "readTeamSidebar",
    "readVisibleProfiles",
    "refreshChannelHistory",
    "refreshJoinedTeams",
    "refreshSavedProfiles",
    "refreshTeamSidebar",
    "rid",
    "selectJoinedTeam",
    "selectSidebarChannel",
    "signOut",
    "signOutOnDevice",
  ]);
});

test("a directory delivered after the account signs out is discarded", async () => {
  const user = "a".repeat(26);
  ipc.mockResolvedValueOnce(18);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    user,
  );
  let finish!: (value: { teams: []; preferences: [] }) => void;
  const read = vi
    .spyOn(directory, "loadAccountDirectory")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  try {
    const pending = account.readAccountDirectory();
    expect(read.mock.calls[0]?.[1]).toBe(user);
    ipc.mockResolvedValueOnce({ status: "signed_out" });
    await account.signOut();
    finish({ teams: [], preferences: [] });
    await expect(pending).rejects.toBe("cancelled");
    await expect(account.readAccountDirectory()).rejects.toBe("cancelled");
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    read.mockRestore();
  }
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

test("an aborted directory refresh releases its ticket without publishing teams", async () => {
  const accountId = "a".repeat(26);
  ipc.mockResolvedValueOnce(7);
  const connection = await openAccountRestConnection(
    "https://chat.example.test",
    accountId,
  );
  const abort = new AbortController();
  const reason = new Error("stopped test request");
  const read = vi
    .spyOn(directory, "loadAccountDirectory")
    .mockImplementation(async () => {
      abort.abort(reason);
      return { teams: [], preferences: [] };
    });
  try {
    ipc.mockResolvedValueOnce(21).mockResolvedValueOnce(undefined);
    await expect(connection.refreshJoinedTeams(abort.signal)).rejects.toBe(
      reason,
    );
    expect(ipc.mock.calls.slice(1)).toEqual([
      ["begin_team_directory_load", { rid: 7 }],
      ["cancel_team_directory_load", { rid: 7, load: 21 }],
    ]);
    await expect(connection.refreshJoinedTeams(abort.signal)).rejects.toBe(
      reason,
    );
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    read.mockRestore();
  }
});

test("aborting an active channel directory releases the native ticket and skips publication", async () => {
  ipc.mockResolvedValueOnce(7);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    "u".repeat(26),
  );
  const teamId = "t".repeat(26);
  const controller = new AbortController();
  const reason = new Error("left team");
  const read = vi
    .spyOn(directory, "loadTeamDirectory")
    .mockImplementation(async () => {
      controller.abort(reason);
      return { teamId, channels: [], categories: [] };
    });
  try {
    ipc.mockResolvedValueOnce(23).mockResolvedValueOnce(undefined);
    await expect(
      account.refreshTeamSidebar(teamId, controller.signal),
    ).rejects.toBe(reason);
    expect(ipc.mock.calls.slice(1)).toEqual([
      ["begin_sidebar_load", { rid: 7, teamId }],
      ["cancel_sidebar_load", { rid: 7, load: 23 }],
    ]);
    expect(read).toHaveBeenCalledOnce();
  } finally {
    read.mockRestore();
  }
});

test("a team no longer on the device does not start a sidebar network fetch", async () => {
  ipc.mockResolvedValueOnce(9);
  const connection = await openAccountRestConnection(
    "https://chat.example.test",
    "u".repeat(26),
  );
  ipc.mockResolvedValueOnce(null);
  expect(await connection.refreshTeamSidebar("t".repeat(26))).toBe(false);
  expect(ipc.mock.calls.slice(1)).toEqual([
    ["begin_sidebar_load", { rid: 9, teamId: "t".repeat(26) }],
  ]);
});
