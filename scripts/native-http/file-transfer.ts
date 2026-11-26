import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

export function fileTransferFixture() {
  const visits: string[] = [];
  const events = new EventEmitter();
  const headers = once(events, "headers");
  const closed = Promise.all(["h", "r", "w"].map((id) => once(events, id)));
  const original = Buffer.alloc(2 * 1024 * 1024 + 17);
  for (let i = 0; i < original.length; i++) original[i] = i % 251;

  function handle(request: IncomingMessage, response: ServerResponse) {
    const path = request.url ?? "";
    if (path === "/file-transfer-check/headers") {
      void headers.then(() => response.end("OK"));
      return true;
    }
    if (path === "/file-transfer-check/closed") {
      void closed.then(() => response.end("OK"));
      return true;
    }
    const match =
      /^\/(Files|Peer)%20Site\/\/A%2FB\/api\/v4\/files\/([a-z])\2{25}(?:\/(thumbnail|preview))?$/.exec(
        path,
      );
    if (!match) return false;
    const [, site, id, representation = "original"] = match;
    assert.equal(request.method, "GET");
    assert.equal(request.headers.authorization, `Bearer file-fixture-${site}`);
    assert.equal(request.headers.range, undefined);
    visits.push(`${site}/${id}/${representation}`);
    switch (id) {
      case "a":
        if (representation === "original") {
          response.setHeader("Content-Length", original.length);
          function* pieces() {
            for (let i = 0; i < original.length; i += 8192)
              yield original.subarray(i, i + 8192);
          }
          Readable.from(pieces()).pipe(response);
        } else {
          response.end(
            representation === "preview"
              ? Buffer.from([0, 1])
              : Buffer.from([255, 0, 2]),
          );
        }
        break;
      case "b":
        response.end();
        break;
      case "c":
        response.write("a");
        response.end("b");
        break;
      case "d":
        response.writeHead(206, { "Content-Range": "bytes 2-3/4" }).end("ab");
        break;
      case "e":
        response.writeHead(403, { "First-Inaccessible-File-Time": "1" }).end(
          JSON.stringify({
            id: "fixture.retention",
            message: "file-fixture-Files",
            request_id: "file-403",
          }),
        );
        break;
      case "g":
        response
          .writeHead(200, { "Content-Length": 12 })
          .write("short", () => response.destroy());
        break;
      case "h":
      case "r":
      case "w":
        response.once("close", () => events.emit(id));
        if (id === "h") events.emit("headers");
        else
          response.writeHead(200, { "Content-Length": 100 }).write("partial");
        break;
      default:
        assert.fail("Unexpected native file ID");
    }
    return true;
  }
  function verify() {
    const expected = [
      "a/original",
      "a/thumbnail",
      "a/preview",
      "b/original",
      "c/original",
      "d/original",
      "e/original",
      "g/original",
      "h/original",
      "r/original",
      "w/original",
      "b/original",
      "b/original",
    ].map((entry) => `Files/${entry}`);
    expected.push("Peer/a/preview");
    assert.deepEqual(visits.sort(), expected.sort());
  }
  return { handle, verify };
}
