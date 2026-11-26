import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

export function activityEventsFixture(frame: (text: string) => Buffer) {
  const id = "h".repeat(26);
  let attempts = 0,
    emptyResumes = 0,
    denied = 0,
    consumer = 0;
  const events = new EventEmitter();
  const closed = once(events, "closed");
  const hello = {
    event: "hello",
    seq: 0,
    data: { connection_id: id },
    broadcast: {},
  };
  const post = { event: "posted", seq: 1, data: {}, broadcast: {} };
  return {
    control(path: string | undefined, response: ServerResponse) {
      if (path === "/event-activity-dormant") {
        assert.equal(attempts, 0);
        response.end("OK");
      } else if (path === "/event-activity-closed") {
        void closed.then(() => response.end("OK"));
      } else return false;
      return true;
    },
    handshake(mode: string, url: URL, socket: Duplex) {
      let status: string | undefined;
      if (mode === "activity") {
        attempts++;
        assert(attempts <= 3);
        assert.equal(
          url.search,
          attempts === 3
            ? `?connection_id=${id}&sequence_number=1`
            : "?connection_id=&sequence_number=0",
        );
        if (attempts === 1) status = "503 Service Unavailable";
      } else if (mode === "activity-empty") {
        emptyResumes++;
        assert.equal(
          url.search,
          emptyResumes === 1
            ? "?connection_id=&sequence_number=0"
            : `?connection_id=${id}&sequence_number=1`,
        );
        if (emptyResumes >= 2 && emptyResumes <= 8)
          status = "503 Service Unavailable";
        else if (emptyResumes === 18) status = "403 Forbidden";
      } else if (mode === "activity-denied") {
        denied++;
        status = "403 Forbidden";
      } else {
        assert.equal(mode, "activity-consumer");
        consumer++;
      }
      if (!status) return false;
      socket.end(
        `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
      return true;
    },
    frames(mode: string, socket: Duplex) {
      if (mode === "activity-empty") {
        if (emptyResumes === 1) socket.write(frame(JSON.stringify(hello)));
        socket.end(Buffer.from([0x88, 2, 0x03, 0xe8]));
        return;
      }
      if (mode === "activity-consumer") {
        socket.write(frame(JSON.stringify(hello)));
        return;
      }
      assert.equal(mode, "activity");
      if (attempts === 2) {
        socket.once("close", () => events.emit("closed"));
        socket.write(frame(JSON.stringify(hello)));
      }
      socket.write(frame(JSON.stringify(post)));
    },
    verify() {
      assert.equal(emptyResumes, 18);
      assert.deepEqual([attempts, denied, consumer], [3, 1, 1]);
    },
  };
}
