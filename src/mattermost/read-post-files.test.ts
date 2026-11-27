import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, it, vi } from "vitest";
import {
  type FileInfo,
  PostsApi,
  ResponseError,
} from "../../vendor/mattermost/index.js";
import { openAccountRestConnection } from "./native-rest.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});

const channelId = "c".repeat(26),
  postId = "p".repeat(26);
const first = {
  id: "a".repeat(26),
  name: "note.txt",
  size: 0,
  channelId,
  postId,
};
const second = { id: "b".repeat(26), name: "note.txt" };
function response(files: FileInfo[] | null) {
  return { raw: new Response(), value: async () => files };
}
function open() {
  vi.mocked(invoke).mockResolvedValueOnce(27);
  return openAccountRestConnection(
    "https://fixture.test/team/chat",
    "u".repeat(26),
  );
}

it("reads the ordered cards once, preserving missing fields and empty wire results", async () => {
  const account = await open(),
    signal = new AbortController().signal;
  const fetch = vi
    .spyOn(PostsApi.prototype, "getFileInfosForPostRaw")
    .mockResolvedValueOnce(response([second, first]));
  expect(await account.readPostFiles(channelId, postId, signal)).toStrictEqual([
    second,
    { id: first.id, name: first.name, size: 0 },
  ]);
  expect(fetch).toHaveBeenCalledExactlyOnceWith({ postId }, { signal });
  for (const empty of [[], null]) {
    fetch.mockResolvedValueOnce(response(empty));
    expect(await account.readPostFiles(channelId, postId)).toStrictEqual([]);
  }
});

it("validates addresses and returns no cards for an inconsistent response", async () => {
  const account = await open(),
    fetch = vi.spyOn(PostsApi.prototype, "getFileInfosForPostRaw");
  await expect(account.readPostFiles("", postId)).rejects.toThrow();
  await expect(account.readPostFiles(channelId, "bad")).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  for (const list of [
    [first, first],
    [first, { ...second, postId: channelId }],
    [{ ...first, channelId: postId }],
    [{ ...second, size: -1 }],
  ]) {
    fetch.mockResolvedValueOnce(response(list));
    await expect(
      account.readPostFiles(channelId, postId),
    ).rejects.toBeInstanceOf(TypeError);
  }
  const denied = new ResponseError(new Response(null, { status: 403 }));
  fetch.mockRejectedValueOnce(denied);
  await expect(account.readPostFiles(channelId, postId)).rejects.toBe(denied);
});

it("discards a partial response without parsing its file cards", async () => {
  const account = await open();
  const cancel = vi.fn();
  const value = vi.fn().mockResolvedValue([first]);
  vi.spyOn(PostsApi.prototype, "getFileInfosForPostRaw").mockResolvedValueOnce({
    raw: new Response(new ReadableStream({ cancel }), { status: 206 }),
    value,
  });
  await expect(account.readPostFiles(channelId, postId)).rejects.toThrow(
    "Incomplete",
  );
  expect(cancel).toHaveBeenCalledOnce();
  expect(value).not.toHaveBeenCalled();
});

it.each(["cancel", "close"])(
  "suppresses previously requested metadata after %s",
  async (mode) => {
    const account = await open(),
      controller = new AbortController();
    let finish!: (files: FileInfo[]) => void;
    const pending = new Promise<FileInfo[]>((resolve) => {
      finish = resolve;
    });
    const fetch = vi
      .spyOn(PostsApi.prototype, "getFileInfosForPostRaw")
      .mockResolvedValueOnce({ raw: new Response(), value: () => pending });
    const read = () =>
      account.readPostFiles(channelId, postId, controller.signal);
    const result = read();
    if (mode === "close") await account.close();
    else controller.abort(new Error("left the post"));
    finish([first]);
    await expect(result).rejects.toBe(
      mode === "close" ? "cancelled" : controller.signal.reason,
    );
    await expect(read()).rejects.toBe(
      mode === "close" ? "unknown_connection" : controller.signal.reason,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
