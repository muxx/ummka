import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, expectTypeOf, test, vi } from "vitest";
import {
  type PostInfo,
  PostsApi,
  type Reaction,
  ReactionsApi,
} from "../../vendor/mattermost/index.js";
import * as emoji from "./account-custom-emoji.ts";
import * as roles from "./channel-permissions.ts";
import { channelProfile } from "./channel-profiles.ts";
import {
  forgetLocalAccount,
  getCurrentAccountId,
  listAccountIds,
  openAccountRestConnection,
  openNativeRestConnection,
} from "./native-rest.ts";
import * as directory from "./navigation-data.ts";
import * as membership from "./own-membership.ts";
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
  expect("stagePost" in connection).toBe(false);
  expect("readPostReactions" in connection).toBe(false);
  expect("changeOwnMembership" in connection).toBe(false);
  expect("addOwnReaction" in connection).toBe(false);
  expect("removeOwnReaction" in connection).toBe(false);
  expect("readPendingPosts" in connection).toBe(false);
  expect("confirmPostDelivery" in connection).toBe(false);
  expect("retireDeliveredPosts" in connection).toBe(false);
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
    "addOwnReaction",
    "basePath",
    "changeOwnMembership",
    "close",
    "confirmPostDelivery",
    "dismissPendingPost",
    "executeServerCommand",
    "fetchApi",
    "getOutgoingPostState",
    "isPostSending",
    "readAccountDirectory",
    "readAssociatedMentionGroups",
    "readChannelMemberCount",
    "readChannelTimezoneCount",
    "readChannelWindow",
    "readCustomEmoji",
    "readDraft",
    "readFileAnchor",
    "readFileSearchPage",
    "readJoinedTeams",
    "readMentionGroupCounts",
    "readPendingPosts",
    "readPostAnchor",
    "readPostDestination",
    "readPostReactions",
    "readPostSearchPage",
    "readSavedPost",
    "readSavedProfiles",
    "readSavedTeamRoles",
    "readTeamDirectory",
    "readTeamSidebar",
    "readVisibleProfiles",
    "readWorkspaceSettings",
    "recordPostRefusal",
    "refreshChannelHistory",
    "refreshJoinedTeams",
    "refreshSavedProfiles",
    "refreshTeamRoles",
    "refreshTeamSidebar",
    "refreshWorkspaceServerPolicy",
    "removeOwnReaction",
    "resendPost",
    "retireDeliveredPosts",
    "retryPendingPost",
    "rid",
    "saveDraft",
    "searchMentionGroups",
    "selectJoinedTeam",
    "selectSidebarChannel",
    "signOut",
    "signOutOnDevice",
    "stagePost",
    "submitDraft",
    "submitDraftCommand",
    "subscribeToPostActivity",
    "transitionDraftCommand",
  ]);
});

test("drafts use the account handle and discard a late read after closing it", async () => {
  ipc.mockResolvedValueOnce(19);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    "a".repeat(26),
  );
  const location = { channelId: "c".repeat(26), rootId: "r".repeat(26) };
  const change = { ...location, message: "draft", expectedRevision: null };
  const current = { message: "other edit", revision: "1".repeat(32) };
  const conflict = { kind: "conflict", draft: current };
  ipc.mockResolvedValueOnce(conflict);
  expect(await account.saveDraft(change)).toEqual(conflict);
  expect(ipc).toHaveBeenLastCalledWith("save_composer_draft", {
    rid: 19,
    ...change,
  });
  let finish!: (v: typeof current) => void;
  ipc.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  const pending = account.readDraft({ channelId: location.channelId });
  expect(ipc).toHaveBeenLastCalledWith("read_composer_draft", {
    rid: 19,
    channelId: location.channelId,
    rootId: null,
  });
  await account.close();
  finish(current);
  await expect(pending).rejects.toBe("cancelled");
  await expect(account.saveDraft(change)).rejects.toBe("unknown_connection");
});

test("a closed account cannot publish a delayed stage result or read pending posts", async () => {
  ipc.mockResolvedValueOnce(37);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    "u".repeat(26),
  );
  const channelId = "c".repeat(26);
  const revision = "a".repeat(32);
  let finish!: () => void;
  ipc.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const stage = account.stagePost({ channelId, revision });
  expect(ipc).toHaveBeenLastCalledWith("stage_composer_post", {
    rid: 37,
    channelId,
    rootId: null,
    revision,
  });
  await account.close();
  finish();
  await expect(stage).rejects.toBe("cancelled");
  await expect(
    account.readPendingPosts({ channelId, after: 0, limit: 20 }),
  ).rejects.toBe("unknown_connection");
  expect(ipc).toHaveBeenLastCalledWith("close_rest_connection", { rid: 37 });
});

test("confirms only the identity of a live server post", async () => {
  ipc.mockResolvedValueOnce(17);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    "u".repeat(26),
  );
  const identity = {
    id: "p".repeat(26),
    userId: "u".repeat(26),
    channelId: "c".repeat(26),
  };
  const source = {
    kind: "response",
    requestPendingId: "id-from-request",
  } as const;
  const post = {
    ...identity,
    rootId: "",
    deleteAt: 0,
    message: "Message text stays out of the receipt",
  };
  for (const invalid of [
    { ...post, deleteAt: 1 },
    { ...post, rootId: undefined },
    { ...post, id: "" },
  ])
    await expect(account.confirmPostDelivery(source, invalid)).resolves.toBe(
      false,
    );
  expect(ipc).toHaveBeenCalledTimes(1);
  ipc.mockResolvedValueOnce(true);
  await expect(account.confirmPostDelivery(source, post)).resolves.toBe(true);
  expect(ipc).toHaveBeenLastCalledWith("confirm_post_delivery", {
    rid: 17,
    post: { ...identity, rootId: null },
    source,
    wirePendingId: null,
  });
  ipc.mockResolvedValueOnce(1);
  await expect(account.retireDeliveredPosts([post.id])).resolves.toBe(1);
  expect(ipc).toHaveBeenLastCalledWith("retire_delivered_posts", {
    rid: 17,
    postIds: [post.id],
  });
});

test("retry actions use the retained attempt and cannot finish on a closed connection", async () => {
  ipc.mockResolvedValueOnce(23);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    "u".repeat(26),
  );
  const key = { pendingId: "fixture-id", attempt: 2 };
  const choice = { kind: "afterRefusal", message: "new text" } as const;
  let done!: () => void;
  ipc.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  const retry = account.retryPendingPost(key, choice);
  expect(ipc).toHaveBeenLastCalledWith("retry_pending_post", {
    rid: 23,
    ...key,
    choice,
  });
  await account.close();
  done();
  await expect(retry).rejects.toBe("cancelled");
  await expect(account.dismissPendingPost(key)).rejects.toBe(
    "unknown_connection",
  );
});

test("explicit offline submission leaves the editor and prior attempt untouched", async () => {
  ipc.mockResolvedValueOnce(31);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    "u".repeat(26),
  );
  vi.stubGlobal("navigator", { onLine: false });
  try {
    await expect(
      account.submitDraft({
        channelId: "c".repeat(26),
        revision: "a".repeat(32),
      }),
    ).resolves.toEqual({ kind: "offline" });
    await expect(
      account.resendPost(
        { pendingId: "waiting", attempt: 1 },
        { kind: "despiteUnknownDelivery" },
      ),
    ).resolves.toEqual({ kind: "offline" });
    expect(ipc).toHaveBeenCalledTimes(1);
    await account.close();
    await expect(
      account.submitDraft({ channelId: "c".repeat(26), revision: "stale" }),
    ).rejects.toBe("unknown_connection");
    await expect(
      account.resendPost(
        { pendingId: "waiting", attempt: 1 },
        { kind: "despiteUnknownDelivery" },
      ),
    ).rejects.toBe("unknown_connection");
    expect(ipc).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
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

test("a role refresh uses the reserved assignments and releases the reservation on a failed read", async () => {
  ipc.mockResolvedValueOnce(7);
  const userId = "u".repeat(26);
  const teamId = "t".repeat(26);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    userId,
  );
  const read = vi.spyOn(roles, "fetchTeamRoleSnapshot");
  try {
    ipc.mockResolvedValueOnce(null);
    expect(await account.refreshTeamRoles(teamId)).toBe(false);
    expect(read).not.toHaveBeenCalled();

    const failure = new Error("second role batch failed");
    read.mockRejectedValueOnce(failure);
    ipc
      .mockResolvedValueOnce({ load: 9, roleNames: ["writer"] })
      .mockResolvedValueOnce(undefined);
    await expect(account.refreshTeamRoles(teamId)).rejects.toBe(failure);
    expect(read).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      ["writer"],
      undefined,
    );
    expect(ipc.mock.calls.slice(1)).toEqual([
      ["begin_team_role_load", { rid: 7, teamId }],
      ["begin_team_role_load", { rid: 7, teamId }],
      ["cancel_team_role_load", { rid: 7, load: 9 }],
    ]);
    const data = {
      systemRoles: "system_user",
      definitions: [{ name: "system_user", permissions: [] }],
    };
    read.mockResolvedValueOnce(data);
    ipc
      .mockResolvedValueOnce({ load: 10, roleNames: [] })
      .mockResolvedValueOnce(false);
    expect(await account.refreshTeamRoles(teamId)).toBe(false);
    expect(ipc.mock.calls.at(-1)).toEqual([
      "store_team_roles",
      { rid: 7, load: 10, data },
    ]);
  } finally {
    read.mockRestore();
  }
});

test("an exact emoji read cannot publish after its account connection closes", async () => {
  ipc.mockResolvedValueOnce(31);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    "u".repeat(26),
  );
  let finish!: (
    result: Awaited<ReturnType<typeof emoji.readCustomEmoji>>,
  ) => void;
  const read = vi.spyOn(emoji, "readCustomEmoji").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    const pending = account.readCustomEmoji("fixture");
    expect(read).toHaveBeenCalledTimes(1);
    await account.close();
    finish({ kind: "missing" });
    await expect(pending).rejects.toBe("cancelled");
    await expect(account.readCustomEmoji("fixture")).rejects.toBe(
      "unknown_connection",
    );
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    read.mockRestore();
  }
});

test("closing an account discards its pending reaction confirmation", async () => {
  ipc.mockResolvedValueOnce(41);
  const userId = "a".repeat(26);
  const postId = "p".repeat(26);
  const account = await openAccountRestConnection(
    "https://fixture.test",
    userId,
  );
  let confirm!: (value: Reaction) => void;
  const answer = new Promise<Reaction>((resolve) => {
    confirm = resolve;
  });
  const save = vi
    .spyOn(ReactionsApi.prototype, "saveReaction")
    .mockReturnValue(answer);
  try {
    const pending = account.addOwnReaction(postId, "wave");
    await account.close();
    confirm({
      userId,
      postId,
      emojiName: "wave",
      channelId: "c".repeat(26),
      createAt: 1,
      updateAt: 1,
      deleteAt: 0,
      remoteId: "",
    });
    await expect(pending).rejects.toBe("cancelled");
    await expect(account.addOwnReaction(postId, "wave")).rejects.toBe(
      "unknown_connection",
    );
    expect(save).toHaveBeenCalledOnce();
  } finally {
    save.mockRestore();
  }
});

test("the signed connection supplies its own user and discards a late membership result after close", async () => {
  const userId = "u".repeat(26);
  const target = { kind: "team" as const, id: "t".repeat(26) };
  ipc.mockResolvedValueOnce(19);
  const account = await openAccountRestConnection(
    "https://chat.example.test",
    userId,
  );
  let finish!: () => void;
  const mutate = vi.spyOn(membership, "changeOwnMembership").mockImplementation(
    () =>
      new Promise((accept) => {
        finish = () => accept({ kind: "applied" });
      }),
  );
  try {
    const change = account.changeOwnMembership(target, "join");
    expect(mutate).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      userId,
      target,
      "join",
    );
    await account.close();
    finish();
    await expect(change).rejects.toBe("cancelled");
    await expect(account.changeOwnMembership(target, "leave")).rejects.toBe(
      "unknown_connection",
    );
    expect(mutate).toHaveBeenCalledTimes(1);
  } finally {
    mutate.mockRestore();
  }
});

test("a post destination from a retired account cannot open in the replacement window", async () => {
  ipc.mockResolvedValueOnce(42);
  const account = await openAccountRestConnection(
    "https://fixture.test",
    "u".repeat(26),
  );
  let resolve!: (info: PostInfo) => void;
  const response = new Promise<PostInfo>((done) => {
    resolve = done;
  });
  const call = vi
    .spyOn(PostsApi.prototype, "getPostInfo")
    .mockReturnValueOnce(response);
  try {
    const pending = account.readPostDestination("p".repeat(26));
    await account.close();
    resolve({
      channelId: "c".repeat(26),
      channelType: "G",
      channelDisplayName: "",
      hasJoinedChannel: true,
      teamId: "",
      teamType: "",
      teamDisplayName: "",
      hasJoinedTeam: false,
    });
    await expect(pending).rejects.toBe("cancelled");
    await expect(account.readPostDestination("p".repeat(26))).rejects.toBe(
      "unknown_connection",
    );
    expect(call).toHaveBeenCalledOnce();
  } finally {
    call.mockRestore();
  }
});
