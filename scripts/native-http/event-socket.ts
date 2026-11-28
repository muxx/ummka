import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

export function eventTextFrame(text: string) {
  const bytes = Buffer.from(text);
  if (bytes.length < 126)
    return Buffer.concat([Buffer.from([0x81, bytes.length]), bytes]);
  const header = Buffer.from([0x81, 126, 0, 0]);
  header.writeUInt16BE(bytes.length, 2);
  return Buffer.concat([header, bytes]);
}
export function upgradeEventSocket(req: IncomingMessage, socket: Duplex) {
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
}
