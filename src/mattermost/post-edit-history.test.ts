import { expect, test, vi } from "vitest";
import {
  Configuration,
  PostsApi,
  ResponseError,
} from "../../vendor/mattermost/index.js";
import { readPostEditHistory } from "./post-edit-history.ts";

const userId = "a".repeat(26);
const target = {
  id: "p".repeat(26),
  channelId: "c".repeat(26),
  rootId: null,
  userId,
};
const file = "f".repeat(26);
const first = {
  id: "x".repeat(26),
  original_id: target.id,
  user_id: userId,
  channel_id: target.channelId,
  root_id: "",
  create_at: 121,
  edit_at: 0,
  delete_at: 432,
  message: "",
  file_ids: [file],
};
const second = {
  ...first,
  id: "y".repeat(26),
  edit_at: 121,
  message: "same millisecond",
  file_ids: null,
};
function fixture(fetchApi: typeof fetch) {
  return new PostsApi(
    new Configuration({ basePath: "https://chat.example.test/team", fetchApi }),
  );
}
test("distinct archived versions retain server order, tie times and their own attachments", async () => {
  const api = fixture(async () => Response.json([second, first]));
  expect(await readPostEditHistory(api, userId, target)).toEqual([
    { id: second.id, timestamp: 121, message: second.message, fileIds: [] },
    { id: first.id, timestamp: 121, message: "", fileIds: [file] },
  ]);
});

test.each([
  { id: target.id },
  { id: second.id },
  { original_id: first.id },
  { user_id: target.id },
  { channel_id: first.id },
  { root_id: first.id },
  { delete_at: 0 },
  { create_at: -1 },
  { edit_at: "42" },
  { message: null },
  { file_ids: "file" },
  { file_ids: ["bad"] },
])(
  "rejects the entire response if one snapshot is malformed or belongs elsewhere (%j)",
  async (change) => {
    const api = fixture(async () =>
      Response.json([second, { ...first, ...change }]),
    );
    await expect(readPostEditHistory(api, userId, target)).rejects.toThrow(
      TypeError,
    );
  },
);

test.each([401, 403, 404])(
  "propagates the server status %i",
  async (status) => {
    const api = fixture(async () =>
      Response.json({ id: "server.error" }, { status }),
    );
    const result = readPostEditHistory(api, userId, target);
    await expect(result).rejects.toBeInstanceOf(ResponseError);
    await expect(result).rejects.toMatchObject({ response: { status } });
  },
);

test("rejects foreign, invalid and aborted targets before dispatch", async () => {
  const fetchApi = vi.fn<typeof fetch>();
  const api = fixture(fetchApi);
  for (const change of [
    { id: "bad" },
    { userId: first.id },
    { channelId: "?" },
    { rootId: target.id },
  ])
    await expect(
      readPostEditHistory(api, userId, { ...target, ...change }),
    ).rejects.toThrow(TypeError);
  await expect(
    readPostEditHistory(api, userId, target, AbortSignal.abort()),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchApi).not.toHaveBeenCalled();
});

test("a late response cannot release versions after cancellation", async () => {
  const controller = new AbortController();
  const fetchApi = vi.fn<typeof fetch>(async (_request, init) => {
    expect(init?.signal).toBe(controller.signal);
    controller.abort();
    return Response.json([first]);
  });
  await expect(
    readPostEditHistory(fixture(fetchApi), userId, target, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchApi).toHaveBeenCalledOnce();
});
