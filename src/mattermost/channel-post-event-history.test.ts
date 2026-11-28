import { expect, test, vi } from "vitest";
import { type Post, ResponseError } from "../../vendor/mattermost/index.js";
import type { ChannelPostChange } from "./account-channel-events.ts";
import { applyPostEventHistory } from "./channel-post-event-history.ts";

const channelId = "c".repeat(26),
  postId = "p".repeat(26),
  rootId = "r".repeat(26);
const edited: ChannelPostChange = { kind: "edited", channelId, postId, rootId };
const wire: Post = {
  id: postId,
  channelId,
  rootId,
  userId: "u".repeat(26),
  message: "updated",
  createAt: 20,
  updateAt: 25,
  editAt: 25,
  deleteAt: 0,
  type: "",
  hashtags: "",
  isPinned: false,
};
function setup() {
  const api = { getPost: vi.fn(async () => wire) };
  const writer = {
    begin: vi.fn(async () => 13),
    cancel: vi.fn(async () => {}),
    store: vi
      .fn<Parameters<typeof applyPostEventHistory>[1]["store"]>()
      .mockResolvedValue({ kind: "applied" }),
  };
  const owner = new AbortController();
  return {
    api,
    writer,
    owner,
    run: (rows: ChannelPostChange[]) =>
      applyPostEventHistory(api, writer, channelId, rows, owner.signal),
  };
}
test("takes the SQLite ticket before HTTP and applies addressed edits and a deletion in one transaction without a synthetic page", async () => {
  const { api, writer, owner, run } = setup();
  const receipt = await run([
    edited,
    { kind: "deleted", channelId, rootId: null, postId: rootId },
  ]);
  expect(writer.begin.mock.invocationCallOrder[0]).toBeLessThan(
    api.getPost.mock.invocationCallOrder[0],
  );
  expect(api.getPost.mock.calls).toEqual([
    [{ postId }, { signal: owner.signal }],
  ]);
  expect(receipt.changes).toEqual([
    expect.objectContaining({ kind: "save", id: postId, message: "updated" }),
    { kind: "remove", channelId, id: rootId },
  ]);
  expect(writer.store).toHaveBeenCalledWith(13, receipt.changes);
  expect(writer.cancel).not.toHaveBeenCalled();
});
test("an invalid owner or changed root releases the receipt and commits no partial deletion", async () => {
  const { api, writer, run } = setup();
  await expect(run([{ ...edited, channelId: rootId }])).rejects.toThrow();
  expect(writer.begin).not.toHaveBeenCalled();
  api.getPost.mockResolvedValue({ ...wire, rootId: "" });
  await expect(run([{ ...edited, kind: "deleted" }, edited])).rejects.toThrow();
  expect(writer.cancel).toHaveBeenCalledWith(13);
  expect(writer.store).not.toHaveBeenCalled();
});
test("losing visibility of a single edited post does not authorize deleting its old history", async () => {
  const { api, writer, run } = setup();
  const unreadable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("The response body closed"));
    },
  });
  api.getPost.mockRejectedValueOnce(
    new ResponseError(new Response(unreadable, { status: 404 })),
  );
  expect((await run([edited])).changes).toEqual([]);
  api.getPost.mockRejectedValueOnce(
    new ResponseError(new Response(null, { status: 403 })),
  );
  const result = await run([
    edited,
    { ...edited, postId: rootId, rootId: null, kind: "deleted" },
  ]);
  expect(result.refused).toEqual([postId]);
  expect(result.changes).toEqual([{ kind: "remove", channelId, id: rootId }]);
  expect(writer.cancel).not.toHaveBeenCalled();
});
test("an abort during GET releases the ticket even when the transport returns a response", async () => {
  const { api, owner, writer, run } = setup();
  api.getPost.mockImplementationOnce(async () => {
    owner.abort();
    return wire;
  });
  await expect(run([edited])).rejects.toMatchObject({ name: "AbortError" });
  expect(writer.cancel).toHaveBeenCalledWith(13);
  expect(writer.store).not.toHaveBeenCalled();
});
