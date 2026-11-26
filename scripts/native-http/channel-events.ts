import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { json } from "node:stream/consumers";

import { activityEventsFixture } from "./activity-events.ts";
import { appliedEventsFixture } from "./applied-events.ts";
import { actionFixture } from "./channel-event-actions.ts";

const fixtureId = "e".repeat(26);
const prefix = "/Event%20Site//";
function frame(text: string) {
  const bytes = Buffer.from(text);
  if (bytes.length < 126)
    return Buffer.concat([Buffer.from([0x81, bytes.length]), bytes]);
  const header = Buffer.from([0x81, 126, 0, 0]);
  header.writeUInt16BE(bytes.length, 2);
  return Buffer.concat([header, bytes]);
}
export function eventFixture() {
  const visits: string[] = [];
  const applied = appliedEventsFixture(frame);
  const activity = activityEventsFixture(frame);
  const actions = actionFixture();
  const events = new EventEmitter();
  const arrived = once(events, "arrived");
  const closed = once(events, "closed");
  let delivery: Duplex | undefined;
  let accepted = 0;
  return {
    control(request: IncomingMessage, response: ServerResponse) {
      const path = request.url;
      if (activity.control(path, response)) return true;
      if (path === `${prefix}delivery/api/v4/posts`) {
        assert.equal(request.method, "POST");
        assert.equal(
          request.headers.authorization,
          "Bearer event-fixture-token",
        );
        const socket = delivery;
        assert(socket);
        void json(request).then((body) => {
          const post = body as Record<string, unknown>;
          assert.equal(post.channel_id, "c".repeat(26));
          assert.equal(post.root_id, "r".repeat(26));
          assert.equal(post.message, "fixture reply");
          const userId = "Abc01234567890123456789012";
          assert(typeof post.pending_post_id === "string");
          assert(post.pending_post_id.startsWith(`${userId}:`));
          accepted++;
          socket.write(
            frame(
              JSON.stringify({
                event: "posted",
                seq: 1,
                broadcast: { channel_id: post.channel_id },
                data: {
                  post: JSON.stringify({
                    ...post,
                    id: "p".repeat(26),
                    user_id: userId,
                    delete_at: 0,
                  }),
                },
              }),
            ),
          );
          response.destroy();
        });
        return true;
      }
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
      if (mode.startsWith("activity") && activity.handshake(mode, url, socket))
        return;
      if (mode !== "applied" && !mode.startsWith("activity")) visits.push(mode);
      const resumed = url.searchParams.get("connection_id") === fixtureId;
      if (mode !== "applied" && !mode.startsWith("activity"))
        assert.equal(
          url.search,
          "?connection_id=" +
            (resumed ? fixtureId : "") +
            "&sequence_number=" +
            (resumed ? 1 : 0),
        );
      if (mode === "actions") {
        assert(!resumed);
        actions.upgrade(req, socket);
        return;
      }
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
      if (mode.startsWith("activity")) {
        activity.frames(mode, socket);
        return;
      }
      if (mode === "applied") {
        applied.send(socket, url);
        return;
      }
      if (mode === "events" || mode === "delivery") {
        if (mode === "delivery") {
          assert(!resumed);
          delivery = socket;
        }
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
      applied.verify();
      activity.verify();
      actions.verify();
      assert.equal(accepted, 1);
      assert.deepEqual(visits, [
        "delivery",
        "actions",
        "actions",
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
