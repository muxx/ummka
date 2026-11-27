import assert from "node:assert/strict";
import { buffer } from "node:stream/consumers";
import { test } from "node:test";
import { Configuration, FilesApi } from "../../vendor/mattermost/index.js";
import { listen } from "./test-server.ts";

test("streams multipart metadata before named file bytes under an installation prefix for both purposes", async (t) => {
  const channelId = "c".repeat(26);
  const id = "f".repeat(26);
  const urls: string[] = [];
  const bytes = new Uint8Array([0, 10, 255, 13]);
  const received: Array<{ contentType: string; data: Buffer }> = [];
  const { base } = await listen(t, async (req, res) => {
    urls.push(req.method + " " + req.url);
    received.push({
      contentType: req.headers["content-type"] ?? "",
      data: await buffer(req),
    });
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        file_infos: [
          { id, channel_id: channelId, name: "план.bin", size: bytes.length },
        ],
        client_ids: ["upload-42"],
      }),
    );
  });
  const api = new FilesApi(
    new Configuration({ basePath: base + "/team/chat" }),
  );
  for (const bookmark of [undefined, true]) {
    const reply = await api.uploadFileRaw({
      channelId,
      clientIds: "upload-42",
      files: new File([bytes], "план.bin"),
      bookmark,
    });
    assert.equal(reply.raw.status, 201);
    const result = await reply.value();
    assert.deepEqual(result.clientIds, ["upload-42"]);
    assert.deepEqual(
      result.fileInfos?.map((f) => [f.id, f.name, f.channelId, f.size]),
      [[id, "план.bin", channelId, bytes.length]],
    );
  }
  assert.deepEqual(urls, [
    "POST /team/chat/api/v4/files",
    "POST /team/chat/api/v4/files?bookmark=true",
  ]);
  for (const { contentType, data } of received) {
    const form = await new Response(Uint8Array.from(data), {
      headers: { "Content-Type": contentType },
    }).formData();
    assert.deepEqual([...form.keys()], ["channel_id", "client_ids", "files"]);
    assert.equal(form.get("channel_id"), channelId);
    assert.equal(form.get("client_ids"), "upload-42");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "план.bin");
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  }
});
