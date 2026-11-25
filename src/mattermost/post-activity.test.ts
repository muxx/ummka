import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, test, vi } from "vitest";
import type { PendingPost } from "./account-delivery.ts";
import { openAccountRestConnection } from "./native-rest.ts";
import { deliverAccountPost } from "./send-account-post.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./send-account-post.ts", () => ({ deliverAccountPost: vi.fn() }));
const ipc = vi.mocked(invoke);
const deliver = vi.mocked(deliverAccountPost);
const post: PendingPost = {
  pendingId: "pending",
  attempt: 1,
  sequence: 1,
  channelId: "c".repeat(26),
  rootId: null,
  message: "Message",
  createdAt: 1,
  previousLogin: false,
  confirmedPostId: null,
  refusal: null,
};
const draft = { channelId: post.channelId, revision: "saved" };
const choice = { kind: "despiteUnknownDelivery" } as const;

beforeEach(() => {
  ipc.mockReset();
  deliver.mockReset();
});

function open(rid: number) {
  ipc.mockResolvedValueOnce(rid);
  return openAccountRestConnection("https://chat.example.test", "u".repeat(26));
}

function holdRequest() {
  let release!: (value: { kind: "unconfirmed" }) => void;
  let fail!: (error: Error) => void;
  deliver.mockReturnValueOnce(
    new Promise((resolve, reject) => {
      release = resolve;
      fail = reject;
    }),
  );
  return { release: () => release({ kind: "unconfirmed" }), fail };
}

async function submit(account: Awaited<ReturnType<typeof open>>) {
  ipc.mockResolvedValueOnce({
    kind: "created",
    post,
    draft: { message: "", revision: "sent" },
  });
  const started = await account.submitDraft(draft);
  if (started.kind !== "sending") throw Error("Expected one staged request");
  return started;
}

test("a reopened view sees its connection's held request without sending or reading again", async () => {
  const account = await open(1);
  const neighbor = await open(2);
  const replyChanged = vi.fn();
  const neighborChanged = vi.fn();
  const first = vi.fn(() => account.isPostSending(post));
  // Two views may share a refresh callback. Unmounting one must leave the other subscribed.
  const leaveFirstView = account.subscribeToPostActivity(draft, first);
  const stop = account.subscribeToPostActivity(draft, first);
  leaveFirstView();
  account.subscribeToPostActivity(
    { ...draft, rootId: "r".repeat(26) },
    replyChanged,
  );
  neighbor.subscribeToPostActivity(draft, neighborChanged);
  const request = holdRequest();
  const started = await submit(account);
  expect(first).toHaveLastReturnedWith(true);
  stop();
  const reopened = vi.fn(() => account.isPostSending(post));
  const leave = account.subscribeToPostActivity(draft, reopened);
  expect(account.isPostSending(started.post)).toBe(true);
  expect(account.isPostSending({ ...post, attempt: 2 })).toBe(false);
  expect(neighbor.isPostSending(post)).toBe(false);
  expect(await account.resendPost(post, choice)).toEqual({
    kind: "unavailable",
  });
  expect(ipc).toHaveBeenCalledTimes(3);
  ipc.mockResolvedValueOnce({ status: "unconfirmed" });
  await account.signOut();
  expect(account.isPostSending(post)).toBe(true);
  request.release();
  await expect(started.completion).resolves.toEqual({ kind: "unconfirmed" });
  expect(reopened).toHaveBeenCalledOnce();
  expect(reopened).toHaveLastReturnedWith(false);
  expect(first).toHaveBeenCalledOnce();
  expect(replyChanged).not.toHaveBeenCalled();
  expect(neighborChanged).not.toHaveBeenCalled();
  expect(deliver).toHaveBeenCalledOnce();
  leave();
});

test("an old failure cannot retire a newer reservation of the same message", async () => {
  const account = await open(13);
  const first = holdRequest();
  const original = await submit(account);
  // Another window already reserved attempt 2. This connection then wins attempt 3.
  const next = { ...post, attempt: 3 };
  const latest = holdRequest();
  ipc.mockResolvedValueOnce(next);
  const retry = await account.resendPost({ ...post, attempt: 2 }, choice);
  if (retry.kind !== "sending") throw Error("Expected a reserved retry");
  first.fail(Error("Connection failed"));
  await expect(original.completion).rejects.toThrow("Connection failed");
  expect(account.isPostSending(original.post)).toBe(false);
  expect(account.isPostSending(next)).toBe(true);
  latest.release();
  await retry.completion;
  expect(account.isPostSending(next)).toBe(false);
  expect(deliver).toHaveBeenCalledTimes(2);
});

test.each(["close", "signOut", "signOutOnDevice"] as const)(
  "%s retires active requests before their late network completions",
  async (operation) => {
    const account = await open(5);
    const held = holdRequest();
    const sending = await submit(account);
    const changed = vi.fn(() => account.isPostSending(post));
    account.subscribeToPostActivity(draft, changed);
    ipc.mockResolvedValueOnce(
      operation === "signOut" ? { status: "signed_out" } : "removed",
    );
    await account[operation]();
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveLastReturnedWith(false);
    const next = await open(6);
    expect(next.isPostSending(post)).toBe(false);
    held.release();
    await expect(sending.completion).rejects.toBe("cancelled");
    expect(changed).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledOnce();
  },
);

test("server-confirmed sign-out retires sends even when device cleanup needs another attempt", async () => {
  const account = await open(7);
  const held = holdRequest();
  const sending = await submit(account);
  const changed = vi.fn(() => account.isPostSending(post));
  account.subscribeToPostActivity(draft, changed);
  const result = {
    status: "server_confirmed_local_removal_failed",
    cause: "credential_storage_unavailable",
  };
  ipc.mockResolvedValueOnce(result);
  expect(await account.signOut()).toEqual(result);
  expect(account.isPostSending(post)).toBe(false);
  expect(changed).toHaveLastReturnedWith(false);
  held.release();
  await expect(sending.completion).rejects.toBe("cancelled");
  await expect(
    account.readSavedProfiles({ ids: [], usernames: [] }),
  ).rejects.toBe("session_unavailable");
  await expect(account.resendPost(post, choice)).rejects.toBe(
    "session_unavailable",
  );
  ipc.mockResolvedValueOnce("removed");
  expect(await account.signOutOnDevice()).toBe("removed");
  expect(ipc).toHaveBeenLastCalledWith("sign_out_on_device", { rid: 7 });
  await expect(account.resendPost(post, choice)).rejects.toBe("cancelled");
  expect(changed).toHaveBeenCalledOnce();
});
