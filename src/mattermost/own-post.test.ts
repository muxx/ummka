import { expect, test, vi } from "vitest";
import {
  Configuration,
  PostsApi,
  ResponseError,
} from "../../vendor/mattermost/index.js";
import { deleteOwnPost, editOwnPostMessage } from "./own-post.ts";

const accountId = "u".repeat(26);
const target = {
  id: "p".repeat(26),
  channelId: "c".repeat(26),
  userId: accountId,
  rootId: "r".repeat(26),
};
const source = "  Сохрани **Markdown**\nещё строка  ";
const wire = {
  id: target.id,
  user_id: accountId,
  channel_id: target.channelId,
  root_id: target.rootId,
  create_at: 100,
  update_at: 200,
  edit_at: 200,
  delete_at: 0,
  hashtags: "",
  type: "",
  is_pinned: true,
  message: "server presentation",
  message_source: source,
};
function client(fetchApi: typeof fetch) {
  return new PostsApi(
    new Configuration({ basePath: "https://example.test/sub", fetchApi }),
  );
}

test("edits exactly the requested message and returns the server projection", async () => {
  const fetchApi = vi.fn<typeof fetch>(async () => Response.json(wire));
  const signal = new AbortController().signal;
  const row = await editOwnPostMessage(
    client(fetchApi),
    accountId,
    target,
    source,
    signal,
  );
  expect(fetchApi).toHaveBeenCalledExactlyOnceWith(
    `https://example.test/sub/api/v4/posts/${target.id}/patch`,
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ message: source }),
      signal,
    }),
  );
  expect(row).toMatchObject({
    ...target,
    message: wire.message,
    messageSource: source,
    editAt: 200,
    isPinned: true,
  });
});

test.each([
  { id: accountId },
  { user_id: target.id },
  { channel_id: target.id },
  { root_id: "" },
  { delete_at: 201 },
  { update_at: false },
])(
  "rejects confirmation for a different or malformed post (%j)",
  async (changes) => {
    const fetchApi = vi.fn<typeof fetch>(async () =>
      Response.json({ ...wire, ...changes }),
    );
    await expect(
      editOwnPostMessage(client(fetchApi), accountId, target, source),
    ).rejects.toThrow(TypeError);
    expect(fetchApi).toHaveBeenCalledTimes(1);
  },
);

test("requires HTTP 200 for either operation and an explicit OK for deletion", async () => {
  const fetchApi = vi.fn<typeof fetch>();
  const api = client(fetchApi);
  fetchApi.mockResolvedValueOnce(Response.json(wire, { status: 202 }));
  await expect(
    editOwnPostMessage(api, accountId, target, source),
  ).rejects.toThrow(TypeError);
  for (const response of [
    Response.json({ status: "pending" }),
    Response.json({ status: "OK" }, { status: 202 }),
    new Response(null, { status: 204 }),
  ]) {
    fetchApi.mockResolvedValueOnce(response);
    await expect(deleteOwnPost(api, accountId, target)).rejects.toThrow(
      TypeError,
    );
  }
  fetchApi.mockResolvedValueOnce(Response.json({ status: "OK" }));
  const signal = new AbortController().signal;
  await deleteOwnPost(api, accountId, target, signal);
  expect(fetchApi).toHaveBeenLastCalledWith(
    `https://example.test/sub/api/v4/posts/${target.id}`,
    expect.objectContaining({ method: "DELETE", signal }),
  );
  expect(fetchApi.mock.lastCall?.[1]?.body).toBeUndefined();
});

test("invalid and cancelled targets cannot dispatch mutations", async () => {
  const fetchApi = vi.fn<typeof fetch>();
  const api = client(fetchApi);
  for (const changes of [
    { id: "bad" },
    { userId: target.id },
    { channelId: "bad" },
    { rootId: target.id },
  ]) {
    await expect(
      deleteOwnPost(api, accountId, { ...target, ...changes }),
    ).rejects.toThrow(TypeError);
    await expect(
      editOwnPostMessage(api, accountId, { ...target, ...changes }, source),
    ).rejects.toThrow(TypeError);
  }
  const signal = AbortSignal.abort();
  await expect(
    editOwnPostMessage(api, accountId, target, source, signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    deleteOwnPost(api, accountId, target, signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchApi).not.toHaveBeenCalled();
});

test.each(["edit", "delete"])(
  "%s never retries on refusal or a lost response",
  async (action) => {
    const fetchApi = vi.fn<typeof fetch>();
    const api = client(fetchApi);
    const run = () =>
      action === "edit"
        ? editOwnPostMessage(api, accountId, target, source)
        : deleteOwnPost(api, accountId, target);
    fetchApi.mockResolvedValueOnce(
      Response.json(
        { id: "api.context.permissions.app_error" },
        { status: 403 },
      ),
    );
    await expect(run()).rejects.toBeInstanceOf(ResponseError);
    fetchApi.mockRejectedValueOnce(new TypeError("connection lost"));
    await expect(run()).rejects.toThrow();
    expect(fetchApi).toHaveBeenCalledTimes(2);
  },
);
