import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

export function fileUploadFixture() {
  const prefix = "/Uploads%20Site//A%2FB/api/v4/files";
  const events = new EventEmitter();
  const gates = {
    reading: once(events, "reading"),
    processing: once(events, "processing"),
    interrupted: once(events, "interrupted"),
    retired: once(events, "retired"),
  };
  const visits: string[] = [];
  const ids = new Set<string>();
  async function accept(request: IncomingMessage, response: ServerResponse) {
    assert.equal(request.method, "POST");
    assert.equal(
      request.headers.authorization,
      "Bearer upload-fixture-session",
    );
    let paused = false;
    const parts: Buffer[] = [];
    try {
      for await (const data of request) {
        const part = Buffer.from(data);
        parts.push(part);
        if (!paused && part.includes(0x7e)) {
          paused = true;
          visits.push("reading");
          events.emit("reading");
        }
      }
    } catch (e) {
      if (!paused || !request.destroyed) throw e;
      events.emit("interrupted");
      return;
    }
    assert.equal(
      paused,
      false,
      "Cancellation must interrupt the multipart body before its closing boundary",
    );
    const form = await new Response(new Uint8Array(Buffer.concat(parts)), {
      headers: { "Content-Type": request.headers["content-type"] ?? "" },
    }).formData();
    assert.deepEqual([...form.keys()], ["channel_id", "client_ids", "files"]);
    assert.equal(form.get("channel_id"), "c".repeat(26));
    const id = form.get("client_ids"),
      file = form.get("files");
    assert.ok(
      typeof id === "string" && /^[a-f0-9-]{36}$/.test(id) && !ids.has(id),
    );
    ids.add(id);
    assert.ok(file instanceof File);
    visits.push(file.name);
    const bookmark = request.url === `${prefix}?bookmark=true`;
    assert.equal(bookmark, file.name === "закладка.txt");
    if (file.name === "план лето.bin") {
      assert.equal(file.size, 2 * 1024 * 1024 + 17);
      assert.equal(file.type, "application/octet-stream");
      assert.ok(Buffer.from(await file.arrayBuffer()).every((b) => b === 0xa5));
      assert.ok(Number(request.headers["content-length"]) > file.size);
    } else if (file.name === "облако.bin") {
      assert.equal(await file.text(), "hello");
    } else if (bookmark) {
      assert.equal(request.headers["content-length"], undefined);
      assert.equal(await file.text(), "✓");
      assert.equal(file.type, "text/plain");
    } else if (file.name === "processing.txt") {
      events.emit("processing");
      response.on("close", () => events.emit("retired"));
      return;
    } else if (file.name === "redirect.txt") {
      response
        .writeHead(307, { Location: "/file-upload-check/redirected" })
        .end();
      return;
    } else assert.equal(file.name, "wrong.txt");
    response.writeHead(201, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        client_ids: [file.name === "wrong.txt" ? "another-attempt" : id],
        file_infos: [
          {
            id: "f".repeat(26),
            channel_id: form.get("channel_id"),
            user_id: bookmark ? "bookmark" : "Abc01234567890123456789012",
            name: bookmark ? "обработано.txt" : file.name,
            size: bookmark ? 5 : file.size,
          },
        ],
      }),
    );
  }
  return {
    handle(request: IncomingMessage, response: ServerResponse) {
      const path = request.url ?? "";
      if (path === prefix || path === `${prefix}?bookmark=true`) {
        void accept(request, response);
        return true;
      }
      if (!path.startsWith("/file-upload-check/")) return false;
      const key = path.slice("/file-upload-check/".length);
      assert.ok(Object.hasOwn(gates, key), key);
      void gates[key as keyof typeof gates].then(() => response.end("OK"));
      return true;
    },
    verify() {
      assert.deepEqual(visits, [
        "план лето.bin",
        "облако.bin",
        "reading",
        "закладка.txt",
        "wrong.txt",
        "redirect.txt",
        "processing.txt",
      ]);
    },
  };
}
