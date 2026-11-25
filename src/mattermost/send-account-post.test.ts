import { expect, test, vi } from "vitest";
import { FetchError, ResponseError } from "../../vendor/mattermost/index.js";
import type { PendingPost } from "./account-delivery.ts";
import { deliverAccountPost } from "./send-account-post.ts";

const userId = "u".repeat(26);
const channelId = "c".repeat(26);
const pending: PendingPost = {
  pendingId: `${userId}:fixture`,
  attempt: 1,
  sequence: 1,
  channelId,
  rootId: null,
  confirmedPostId: null,
  message: "  Exact text\n",
  createdAt: 1,
  previousLogin: false,
  refusal: null,
};
const server = {
  id: "p".repeat(26),
  userId,
  channelId,
  rootId: "",
  deleteAt: 0,
};
const receipts = () => ({
  confirmPostDelivery: vi.fn().mockResolvedValue(true),
  recordPostRefusal: vi.fn().mockResolvedValue("delivery"),
});

test("sends the retained identity, accepts an omitted pending ID and preserves independent canonical responses", async () => {
  const store = receipts();
  store.confirmPostDelivery.mockResolvedValue(false);
  const request = { createPost: vi.fn().mockResolvedValue(server) };
  await expect(
    deliverAccountPost(request, userId, pending, store),
  ).resolves.toEqual({ kind: "accepted", post: server, matched: false });
  expect(request.createPost).toHaveBeenCalledExactlyOnceWith({
    createPostRequest: {
      channelId,
      message: pending.message,
      pendingPostId: pending.pendingId,
    },
  });
  expect(store.confirmPostDelivery).toHaveBeenCalledWith(
    { kind: "response", requestPendingId: pending.pendingId },
    server,
  );
  const reply = { ...pending, rootId: "r".repeat(26) };
  request.createPost.mockResolvedValue({
    ...server,
    rootId: reply.rootId,
    pendingPostId: pending.pendingId,
  });
  await expect(
    deliverAccountPost(request, userId, reply, store),
  ).resolves.toMatchObject({ kind: "accepted" });
  expect(request.createPost).toHaveBeenLastCalledWith({
    createPostRequest: {
      channelId,
      rootId: reply.rootId,
      message: reply.message,
      pendingPostId: reply.pendingId,
    },
  });
});

test("never correlates a malformed, removed, foreign or differently keyed server response", async () => {
  const store = receipts();
  for (const response of [
    null,
    { ...server, id: "" },
    { ...server, userId: "another" },
    { ...server, rootId: server.id },
    { ...server, channelId: "other" },
    { ...server, deleteAt: 1 },
    { ...server, pendingPostId: "different" },
  ]) {
    await expect(
      deliverAccountPost(
        { createPost: vi.fn().mockResolvedValue(response) },
        userId,
        pending,
        store,
      ),
    ).resolves.toEqual({ kind: "unconfirmed" });
  }
  expect(store.confirmPostDelivery).not.toHaveBeenCalled();
});

test("only a scoped public 4xx records a refusal and a lost response never starts another request", async () => {
  const store = receipts();
  const fail = (error: unknown) =>
    deliverAccountPost(
      { createPost: vi.fn().mockRejectedValue(error) },
      userId,
      pending,
      store,
    );
  const error = (status: number, body: string) =>
    new ResponseError(new Response(body, { status }));
  const body = JSON.stringify({
    id: "api.refused",
    status_code: 403,
    message: "Published reason",
    detailed_error: "private",
  });
  const refusal = {
    status: 403,
    code: "api.refused",
    message: "Published reason",
  };
  for (const failure of [
    error(502, body),
    error(403, "invalid JSON"),
    error(403, "{}"),
    error(400, body),
    new SyntaxError("Incomplete success"),
    new FetchError(new TypeError("Lost connection")),
  ]) {
    await expect(fail(failure)).resolves.toEqual({ kind: "unconfirmed" });
  }
  await expect(fail(error(401, body))).resolves.toEqual({
    kind: "unauthorized",
  });
  expect(store.recordPostRefusal).not.toHaveBeenCalled();
  await expect(fail(error(403, body))).resolves.toEqual({
    kind: "refused",
    refusal,
  });
  expect(store.recordPostRefusal).toHaveBeenCalledWith(pending, refusal);
  store.recordPostRefusal.mockResolvedValue("retry");
  await expect(fail(error(403, body))).resolves.toEqual({
    kind: "unconfirmed",
    retryRefusal: refusal,
  });
  store.recordPostRefusal.mockResolvedValue(null);
  await expect(fail(error(403, body))).resolves.toEqual({
    kind: "unconfirmed",
  });
  await expect(
    fail(
      new FetchError(new TypeError("closed", { cause: "session_unavailable" })),
    ),
  ).rejects.toBe("session_unavailable");
});
