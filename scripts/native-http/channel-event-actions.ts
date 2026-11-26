import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";

const channel = "c".repeat(26);
const root = "r".repeat(26);
const peer = "p".repeat(26);

export function actionFixture() {
  const server = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });
  const received: number[] = [];
  return {
    upgrade(request: IncomingMessage, socket: Duplex) {
      server.handleUpgrade(request, socket, Buffer.alloc(0), (ws) => {
        const connection = received.push(0) - 1;
        ws.send(
          JSON.stringify({
            event: "hello",
            seq: 0,
            data: { connection_id: "e".repeat(26) },
            broadcast: {},
          }),
        );
        ws.on("message", (bytes, binary) => {
          assert.equal(binary, false);
          const seq = ++received[connection];
          const message = JSON.parse(bytes.toString());
          if (seq === 1) {
            assert.deepEqual(message, { seq, action: "ping" });
            ws.send(
              JSON.stringify({
                event: "typing",
                seq: 1,
                data: { user_id: peer, parent_id: root },
                broadcast: { channel_id: channel },
              }),
            );
            ws.send(
              JSON.stringify({
                status: "OK",
                seq_reply: seq,
                data: { text: "pong" },
              }),
            );
          } else {
            assert(seq === 2 || seq === 3);
            assert.deepEqual(message, {
              seq,
              action: "user_typing",
              data: { channel_id: channel, parent_id: seq === 2 ? "" : root },
            });
            ws.send(
              JSON.stringify({
                status: seq === 2 ? "OK" : "FAIL",
                seq_reply: seq,
              }),
            );
          }
        });
      });
    },
    verify() {
      assert.deepEqual(received, [3, 1]);
    },
  };
}
