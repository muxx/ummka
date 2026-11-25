import { expect, test, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { accountPostReactions } from "./account-post-reactions.ts";

const postId = "p".repeat(26);
const userId = "u".repeat(26);
const row = {
  post_id: postId,
  user_id: userId,
  emoji_name: "+1",
  channel_id: "c".repeat(26),
  create_at: 10,
  update_at: 10,
  delete_at: 0,
  remote_id: null,
};
function fixture(response: unknown, status = 200) {
  const fetchApi = vi.fn<typeof fetch>(async () =>
    Response.json(response, { status }),
  );
  const config = new Configuration({
    basePath: "https://example.test/prefix",
    fetchApi,
  });
  return {
    fetchApi,
    account: accountPostReactions(config, userId, (read) => read()),
  };
}

test("reads an empty post and preserves server order and legacy channel IDs", async () => {
  expect(await fixture(null).account.readPostReactions(postId)).toEqual([]);
  const other = "v".repeat(26);
  const { account, fetchApi } = fixture([
    row,
    { ...row, user_id: other, channel_id: "", remote_id: "" },
  ]);
  const rows = await account.readPostReactions(postId);
  expect(rows.map((r) => r.userId)).toEqual([userId, other]);
  expect(rows[1]?.channelId).toBe("");
  expect(fetchApi.mock.calls[0]?.[0]).toBe(
    `https://example.test/prefix/api/v4/posts/${postId}/reactions`,
  );
});

test.each([
  null,
  { ...row, post_id: "a".repeat(26) },
  { ...row, user_id: "x" },
  { ...row, delete_at: 5 },
  { ...row, update_at: -1 },
  { ...row, emoji_name: "wave/hand" },
  { ...row, channel_id: "x" },
  { ...row, remote_id: 2 },
])("rejects a malformed or misdirected list entry", async (entry) => {
  await expect(
    fixture([entry]).account.readPostReactions(postId),
  ).rejects.toThrow(TypeError);
});

test("adds the connection owner and removes only that user's encoded reaction", async () => {
  const add = fixture(row);
  expect(await add.account.addOwnReaction(postId, "+1")).toMatchObject({
    userId,
    postId,
    emojiName: "+1",
  });
  const request = add.fetchApi.mock.calls[0]?.[1];
  expect(request?.method).toBe("POST");
  expect(JSON.parse(String(request?.body))).toEqual({
    post_id: postId,
    user_id: userId,
    emoji_name: "+1",
  });
  const remove = fixture({ status: "OK" });
  expect(await remove.account.removeOwnReaction(postId, "+1")).toBeUndefined();
  expect(remove.fetchApi.mock.calls[0]?.[0]).toBe(
    `https://example.test/prefix/api/v4/users/me/posts/${postId}/reactions/%2B1`,
  );
  expect(remove.fetchApi.mock.calls[0]?.[1]?.method).toBe("DELETE");
});

test.each([
  { ...row, user_id: "a".repeat(26) },
  { ...row, emoji_name: "wave" },
])("refuses confirmation of another participant or emoji", async (answer) => {
  await expect(
    fixture(answer).account.addOwnReaction(postId, "+1"),
  ).rejects.toThrow(TypeError);
});

test("propagates permission denial, checks the removal acknowledgement and does not repeat writes", async () => {
  const denied = fixture({ id: "api.context.permissions.app_error" }, 403);
  await expect(
    denied.account.removeOwnReaction(postId, "+1"),
  ).rejects.toBeInstanceOf(ResponseError);
  expect(denied.fetchApi).toHaveBeenCalledOnce();
  await expect(
    fixture({}).account.removeOwnReaction(postId, "+1"),
  ).rejects.toThrow(TypeError);
});

test("invalid IDs, emoji names and cancelled requests stop before transport", async () => {
  const { account, fetchApi } = fixture(row);
  await expect(account.readPostReactions("../me")).rejects.toThrow(TypeError);
  for (const name of ["", "+".repeat(65), "%2B1", "a/b", "wave\n"]) {
    await expect(account.addOwnReaction(postId, name)).rejects.toThrow(
      TypeError,
    );
    await expect(account.removeOwnReaction(postId, name)).rejects.toThrow(
      TypeError,
    );
  }
  const signal = AbortSignal.abort();
  await expect(account.readPostReactions(postId, signal)).rejects.toMatchObject(
    { name: "AbortError" },
  );
  expect(fetchApi).not.toHaveBeenCalled();
});

test("discards a response received during cancellation", async () => {
  const controller = new AbortController();
  const { account, fetchApi } = fixture(row);
  fetchApi.mockImplementationOnce(async (_input, init) => {
    expect(init?.signal).toBe(controller.signal);
    controller.abort();
    return Response.json(row);
  });
  await expect(
    account.addOwnReaction(postId, "+1", controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
