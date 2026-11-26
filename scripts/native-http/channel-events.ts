import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

const fixtureId = "e".repeat(26);
const prefix = "/Event%20Site//";
function frame(text: string) {
  const bytes = Buffer.from(text);
  assert(bytes.length < 126);
  return Buffer.concat([Buffer.from([0x81, bytes.length]), bytes]);
}
export function eventFixture() {
  const visits: string[] = [];
  const events = new EventEmitter();
  const arrived = once(events, "arrived");
  const closed = once(events, "closed");
  return {
    control(path: string | undefined, response: ServerResponse) {
      if (
        path !== "/event-handshake-arrived" &&
        path !== "/event-handshake-closed"
      )
        return false;
      void (path.endsWith("arrived") ? arrived : closed).then(() =>
        response.end("OK"),
      );
      return true;
    },
    upgrade(req: IncomingMessage, socket: Duplex) {
      const url = new URL(req.url ?? "", "https://fixture.test");
      assert.equal(req.method, "GET");
      assert.equal(req.headers.authorization, "Bearer event-fixture-token");
      assert.equal(req.headers.cookie, undefined);
      assert.equal(req.headers.upgrade, "websocket");
      const mode = url.pathname.slice(prefix.length).split("/")[0];
      assert.equal(url.pathname, prefix + mode + "/api/v4/websocket");
      visits.push(mode);
      const resumed = url.searchParams.get("connection_id") === fixtureId;
      assert.equal(
        url.search,
        "?connection_id=" +
          (resumed ? fixtureId : "") +
          "&sequence_number=" +
          (resumed ? 1 : 0),
      );
      if (mode === "hold") {
        socket.once("close", () => events.emit("closed"));
        socket.on("end", () => socket.end());
        events.emit("arrived");
        return;
      }
      if (mode === "denied") {
        // Node detached this socket for Upgrade. It cannot serve another HTTP request.
        socket.end(
          "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
        return;
      }
      const key = req.headers["sec-websocket-key"];
      assert.equal(typeof key, "string");
      assert(key);
      const accept = createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: " +
          accept +
          "\r\n\r\n",
      );
      socket.on("end", () => socket.end());
      if (mode === "events") {
        const message = resumed
          ? {
              event: "posted",
              seq: 1,
              data: { post: "fixture" },
              broadcast: {},
            }
          : {
              event: "hello",
              seq: 0,
              data: { connection_id: fixtureId },
              broadcast: {},
            };
        socket.write(frame(JSON.stringify(message)));
      } else if (mode === "closed") {
        socket.end(Buffer.from([0x88, 2, 0x03, 0xe8]));
      } else {
        assert.equal(mode, "malformed");
        socket.write(frame("not an event"));
      }
    },
    verify() {
      assert.deepEqual(visits, [
        "events",
        "events",
        "closed",
        "malformed",
        "denied",
        "hold",
      ]);
    },
  };
}
