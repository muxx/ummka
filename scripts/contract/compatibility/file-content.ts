import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  Configuration,
  FilesApi,
  PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

type Variant = "getFileRaw" | "getFileThumbnailRaw" | "getFilePreviewRaw";
const variants: readonly Variant[] = [
  "getFileRaw",
  "getFileThumbnailRaw",
  "getFilePreviewRaw",
];

async function statusOf(
  request: Promise<unknown>,
  status: number,
): Promise<Response> {
  try {
    await request;
  } catch (error) {
    assert.ok(error instanceof ResponseError);
    assert.equal(error.response.status, status);
    return error.response;
  }
  return assert.fail(`Expected HTTP ${status}`);
}

async function measure(body: ReadableStream<Uint8Array> | null) {
  assert.ok(body);
  const reader = body.getReader();
  const hash = createHash("sha256");
  const first = new Uint8Array(16);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length < first.length)
      first.set(value.subarray(0, first.length - length), length);
    length += value.byteLength;
    hash.update(value);
  }
  return { length, first, sha256: hash.digest("hex") };
}

export async function checkFileContent(
  session: Configuration,
  authorization: Record<string, string>,
  readerToken: string,
  channelId: string,
  join: () => Promise<unknown>,
) {
  const basePath = session.basePath;
  const reader = new FilesApi(
    new Configuration({ basePath, accessToken: readerToken }),
  );
  const anonymous = new FilesApi(new Configuration({ basePath }));
  const posts = new PostsApi(session);
  const image = await fetch("http://images.example.test:8099/sample.png");
  assert.equal(image.status, 200);
  const png = new Uint8Array(await image.arrayBuffer());
  const opaque = new Uint8Array(randomBytes(2 * 1024 * 1024 + 19));
  async function attach(
    bytes: Uint8Array<ArrayBuffer>,
    name: string,
    type: string,
  ) {
    const form = new FormData();
    form.set("channel_id", channelId);
    form.set("files", new Blob([bytes], { type }), name);
    const upload = await fetch(`${basePath}/api/v4/files`, {
      method: "POST",
      headers: authorization,
      body: form,
    });
    assert.equal(upload.status, 201);
    const id: unknown = (await upload.json()).file_infos[0].id;
    assert.ok(typeof id === "string" && id.length === 26);
    const post = await posts.createPost({
      createPostRequest: {
        channelId,
        message: "File content fixture",
        fileIds: [id],
      },
    });
    assert.ok(post.id);
    return id;
  }
  const imageId = await attach(png, "file-content.png", "image/png");
  const opaqueId = await attach(
    opaque,
    "file-content.bin",
    "application/octet-stream",
  );
  for (const method of variants) {
    for (const [api, status, errorId] of [
      [reader, 403, "api.context.permissions.app_error"],
      [anonymous, 401, "api.context.session_expired.app_error"],
    ] as const) {
      const denied = await statusOf(api[method]({ fileId: imageId }), status);
      assert.equal((await denied.json()).id, errorId);
    }
  }
  // Membership is the only change before the same reader asks for the same bytes.
  await join();
  for (const file of [
    { id: imageId, bytes: png, image: true },
    { id: opaqueId, bytes: opaque, image: false },
  ]) {
    for (const method of variants) {
      if (!file.image && method !== "getFileRaw") {
        const missing = await statusOf(
          reader[method]({ fileId: file.id }),
          400,
        );
        assert.equal(
          (await missing.json()).id,
          method === "getFilePreviewRaw"
            ? "api.file.get_file_preview.no_preview.app_error"
            : "api.file.get_file_thumbnail.no_thumbnail.app_error",
        );
        continue;
      }
      const response = (await reader[method]({ fileId: file.id })).raw;
      assert.equal(response.status, 200);
      const all = await measure(response.body);
      if (method === "getFileRaw") {
        assert.equal(
          response.headers.get("content-type"),
          file.image ? "image/png" : "application/octet-stream",
        );
        assert.equal(all.length, file.bytes.byteLength);
        assert.equal(
          all.sha256,
          createHash("sha256").update(file.bytes).digest("hex"),
        );
      } else {
        assert.equal(response.headers.get("content-type"), "image/jpeg");
        assert.deepEqual(all.first.subarray(0, 8), png.subarray(0, 8));
      }
      const part = (
        await reader[method]({ fileId: file.id, range: "bytes=4-11" })
      ).raw;
      assert.equal(part.status, 206);
      assert.equal(
        part.headers.get("content-range"),
        `bytes 4-11/${all.length}`,
      );
      assert.deepEqual(
        new Uint8Array(await part.arrayBuffer()),
        all.first.subarray(4, 12),
      );
      const beyond = await statusOf(
        reader[method]({ fileId: file.id, range: `bytes=${all.length}-` }),
        416,
      );
      assert.equal(
        beyond.headers.get("content-range"),
        `bytes */${all.length}`,
      );
      await beyond.body?.cancel();
    }
  }
}
