import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, test, vi } from "vitest";
import {
  type FileInfo,
  FilesApi,
  PostsApi,
  ResponseError,
} from "../../vendor/mattermost/index.js";
import { openAccountRestConnection } from "./native-rest.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});

const postId = "p".repeat(26),
  fileId = "f".repeat(26),
  channelId = "c".repeat(26);
const visible = {
  id: postId,
  channelId,
  rootId: "",
  userId: "u".repeat(26),
  createAt: 110,
  updateAt: 150,
  editAt: 140,
  deleteAt: 0,
  type: "",
  message: "Fixture #release",
  hashtags: "#release",
  isPinned: true,
};
function open() {
  vi.mocked(invoke).mockResolvedValueOnce(27);
  return openAccountRestConnection(
    "https://fixture.test/subpath",
    "u".repeat(26),
  );
}

test("reads only the addressed file and preserves standalone and empty files", async () => {
  const account = await open();
  const signal = new AbortController().signal;
  const fetch = vi.spyOn(FilesApi.prototype, "getFileInfoRaw");
  for (const [id, linked] of [
    [fileId, postId],
    ["b".repeat(26), ""],
    ["a".repeat(26), undefined],
  ] as const) {
    const file = { id, name: "note.txt", size: 0 };
    fetch.mockClear();
    fetch.mockResolvedValueOnce({
      raw: new Response(),
      value: async () => ({
        ...file,
        channelId,
        postId: linked,
        userId: "u".repeat(26),
      }),
    });
    expect(await account.readChannelFile(channelId, id, signal)).toStrictEqual({
      file,
      postId: linked || null,
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith({ fileId: id }, { signal });
  }
});

test("rejects malformed input, mismatched file addresses and invalid metadata", async () => {
  const account = await open();
  const fetch = vi.spyOn(FilesApi.prototype, "getFileInfoRaw");
  await expect(account.readChannelFile("", fileId)).rejects.toThrow();
  await expect(account.readChannelFile(channelId, "short")).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  for (const invalid of [
    { id: postId },
    { channelId: postId },
    { channelId: undefined },
    { postId: "invalid" },
    { size: -1 },
    { height: Infinity },
  ]) {
    fetch.mockResolvedValueOnce({
      raw: new Response(),
      value: async () => ({ id: fileId, channelId, ...invalid }),
    });
    await expect(
      account.readChannelFile(channelId, fileId),
    ).rejects.toBeInstanceOf(TypeError);
  }
});

test("discards partial file information and preserves server refusals", async () => {
  const account = await open();
  const fetch = vi.spyOn(FilesApi.prototype, "getFileInfoRaw");
  const cancel = vi.fn();
  const value = vi.fn().mockResolvedValue({ id: fileId, channelId });
  fetch.mockResolvedValueOnce({
    raw: new Response(new ReadableStream({ cancel }), { status: 206 }),
    value,
  });
  await expect(account.readChannelFile(channelId, fileId)).rejects.toThrow(
    "Incomplete",
  );
  expect(cancel).toHaveBeenCalledOnce();
  expect(value).not.toHaveBeenCalled();
  for (const status of [403, 404]) {
    const failure = new ResponseError(new Response(null, { status }));
    fetch.mockRejectedValueOnce(failure);
    await expect(account.readChannelFile(channelId, fileId)).rejects.toBe(
      failure,
    );
  }
});

test.each(["cancel", "close"])(
  "discards late file details after %s",
  async (action) => {
    const account = await open();
    const controller = new AbortController();
    let finish!: (info: FileInfo) => void;
    const decoded = new Promise<FileInfo>((resolve) => {
      finish = resolve;
    });
    const fetch = vi
      .spyOn(FilesApi.prototype, "getFileInfoRaw")
      .mockResolvedValueOnce({
        raw: new Response(),
        value: () => decoded,
      });
    const read = () =>
      account.readChannelFile(channelId, fileId, controller.signal);
    const pending = read();
    if (action === "close") await account.close();
    else controller.abort(new Error("left files"));
    finish({ id: fileId, channelId });
    await expect(pending).rejects.toBe(
      action === "close" ? "cancelled" : controller.signal.reason,
    );
    await expect(read()).rejects.toBe(
      action === "close" ? "unknown_connection" : controller.signal.reason,
    );
    expect(fetch).toHaveBeenCalledOnce();
  },
);

test("one account read returns the published post with its address; files identify their post", async () => {
  const account = await open();
  const post = vi.spyOn(PostsApi.prototype, "getPost");
  const file = vi.spyOn(FilesApi.prototype, "getFileInfo");
  for (const rootId of ["", "r".repeat(26)]) {
    post.mockClear();
    post.mockResolvedValueOnce({ ...visible, rootId });
    await expect(account.readPostAnchor(postId)).resolves.toEqual({
      postId,
      channelId,
      rootId: rootId || null,
      post: {
        id: postId,
        channelId,
        userId: visible.userId,
        rootId: rootId || null,
        createAt: 110,
        updateAt: 150,
        editAt: 140,
        type: "",
        message: "Fixture #release",
        messageSource: null,
        hashtags: "#release",
        isPinned: true,
      },
    });
    expect(post).toHaveBeenCalledExactlyOnceWith(
      { postId },
      { signal: undefined },
    );
  }
  for (const linked of [undefined, "", postId]) {
    file.mockResolvedValueOnce({ id: fileId, channelId, postId: linked });
    await expect(account.readFileAnchor(fileId)).resolves.toEqual({
      fileId,
      channelId,
      postId: linked || null,
    });
  }
});

test("a deleted post retains its address without exposing the former content", async () => {
  const account = await open();
  vi.spyOn(PostsApi.prototype, "getPost").mockResolvedValueOnce({
    ...visible,
    deleteAt: 200,
  });
  expect(await account.readPostAnchor(postId)).toEqual({
    postId,
    channelId,
    post: null,
  });
});

test("rejects a bad input before transport and mismatched or malformed replies", async () => {
  const account = await open();
  const post = vi.spyOn(PostsApi.prototype, "getPost");
  const file = vi.spyOn(FilesApi.prototype, "getFileInfo");
  await expect(account.readFileAnchor("no")).rejects.toBeInstanceOf(TypeError);
  await expect(account.readPostAnchor("no")).rejects.toBeInstanceOf(TypeError);
  expect(post).not.toHaveBeenCalled();
  expect(file).not.toHaveBeenCalled();
  for (const bad of [
    { id: fileId },
    { channelId: "" },
    { rootId: postId },
    { rootId: undefined },
    { rootId: "no" },
    { userId: "" },
    { createAt: 0 },
    { message: undefined },
  ]) {
    post.mockResolvedValueOnce({ ...visible, ...bad });
    await expect(account.readPostAnchor(postId)).rejects.toBeInstanceOf(
      TypeError,
    );
  }
  for (const bad of [{ id: postId }, { channelId: "" }, { postId: "no" }]) {
    file.mockResolvedValueOnce({ id: fileId, channelId, ...bad });
    await expect(account.readFileAnchor(fileId)).rejects.toBeInstanceOf(
      TypeError,
    );
  }
});

test.each(["post", "file"] as const)(
  "preserves %s access and retention failures",
  async (kind) => {
    const account = await open();
    const failure = new ResponseError(
      new Response(null, {
        status: 403,
        headers: { [`first-inaccessible-${kind}-time`]: "1" },
      }),
    );
    vi.spyOn(PostsApi.prototype, "getPost").mockRejectedValue(failure);
    vi.spyOn(FilesApi.prototype, "getFileInfo").mockRejectedValue(failure);
    const pending =
      kind === "post"
        ? account.readPostAnchor(postId)
        : account.readFileAnchor(fileId);
    await expect(pending).rejects.toBe(failure);
  },
);

test.each(["post", "file"] as const)(
  "drops a late %s after cancellation or account close",
  async (kind) => {
    for (const close of [false, true]) {
      const account = await open(),
        controller = new AbortController();
      let finish!: () => void;
      const read =
        kind === "post"
          ? () => account.readPostAnchor(postId, controller.signal)
          : () => account.readFileAnchor(fileId, controller.signal);
      const pending = new Promise<{
        id: string;
        channelId: string;
        rootId: string;
      }>((resolve) => {
        finish = () =>
          resolve({
            ...visible,
            id: kind === "post" ? postId : fileId,
          });
      });
      vi.spyOn(PostsApi.prototype, "getPost").mockReturnValueOnce(pending);
      vi.spyOn(FilesApi.prototype, "getFileInfo").mockReturnValueOnce(pending);
      const result = read();
      if (close) await account.close();
      else controller.abort(new Error("left search"));
      finish();
      await expect(result).rejects.toBe(
        close ? "cancelled" : controller.signal.reason,
      );
      await expect(read()).rejects.toBe(
        close ? "unknown_connection" : controller.signal.reason,
      );
      vi.restoreAllMocks();
    }
  },
);

test.each(["post", "file"] as const)(
  "cancellation at the account boundary discards the decoded %s",
  async (kind) => {
    const account = await open();
    const controller = new AbortController();
    let finish!: () => void;
    const decoded = new Promise<{
      id: string;
      channelId: string;
      rootId: string;
    }>((resolve) => {
      finish = () =>
        resolve({
          ...visible,
          id: kind === "post" ? postId : fileId,
        });
    });
    vi.spyOn(PostsApi.prototype, "getPost").mockReturnValueOnce(decoded);
    vi.spyOn(FilesApi.prototype, "getFileInfo").mockReturnValueOnce(decoded);
    const read =
      kind === "post"
        ? account.readPostAnchor(postId, controller.signal)
        : account.readFileAnchor(fileId, controller.signal);
    const reason = new Error("closed search");
    void decoded.then(() => controller.abort(reason));
    finish();
    await expect(read).rejects.toBe(reason);
  },
);
