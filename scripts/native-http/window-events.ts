import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { eventTextFrame, upgradeEventSocket } from "./event-socket.ts";

export function windowEventsFixture() {
  const channel = "b".repeat(26);
  const queue = "w".repeat(26);
  const replacement = "n".repeat(26);
  let visits = 0;
  const hello = (connection_id: string) =>
    eventTextFrame(
      JSON.stringify({
        event: "hello",
        seq: 0,
        data: { connection_id },
        broadcast: {},
      }),
    );
  const post = (seq: number, event = "post_edited") =>
    eventTextFrame(
      JSON.stringify({
        event,
        seq,
        broadcast: { channel_id: channel },
        data: {
          post: JSON.stringify({
            channel_id: channel,
            id: String(seq).padStart(26, "0"),
            root_id: "",
            delete_at: 0,
            message: "fixture private content",
          }),
        },
      }),
    );
  return {
    upgrade(req: IncomingMessage, socket: Duplex) {
      const url = new URL(req.url ?? "/", "https://localhost");
      assert.equal(url.pathname, "/team/chat/api/v4/websocket");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers.cookie, undefined);
      visits++;
      const expected = [
        "?connection_id=&sequence_number=0",
        `?connection_id=${queue}&sequence_number=1`,
        `?connection_id=${queue}&sequence_number=41`,
        `?connection_id=${replacement}&sequence_number=1`,
      ];
      assert.equal(url.search, expected[visits - 1]);
      console.log("Window event fixture accepted connection", visits);
      upgradeEventSocket(req, socket);
      if (visits === 1) {
        socket.write(Buffer.concat([hello(queue), post(1)]));
      } else if (visits === 2) {
        socket.end(
          Buffer.concat([
            ...Array.from({ length: 40 }, (_, index) => post(index + 1)),
            Buffer.from([0x88, 2, 0x03, 0xe8]),
          ]),
        );
      } else if (visits === 3) {
        socket.write(
          Buffer.concat([hello(replacement), post(1, "post_deleted")]),
        );
      } else {
        socket.write(post(1, "post_deleted"));
      }
    },
    verify() {
      assert.equal(visits, 4);
    },
  };
}
