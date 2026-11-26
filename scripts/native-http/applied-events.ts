import assert from "node:assert/strict";
import type { Duplex } from "node:stream";

export function appliedEventsFixture(frame: (text: string) => Buffer) {
  const first = "e".repeat(26);
  const second = "f".repeat(26);
  function hello(id: string) {
    return {
      event: "hello",
      seq: 0,
      data: { connection_id: id },
      broadcast: {},
    };
  }
  function event(name: string, seq: number) {
    return { event: name, seq, data: {}, broadcast: {} };
  }
  const receipt = { seq_reply: 1, status: "OK", data: { text: "pong" } };
  const attempts = [
    {
      id: "",
      next: 0,
      frames: [hello(first), event("custom_notice", 1), event("posted", 2)],
    },
    {
      id: first,
      next: 2,
      frames: [receipt, event("posted", 2), hello(second)],
    },
    {
      id: first,
      next: 3,
      frames: [
        hello(second),
        event("post_edited", 1),
        event("unexpected_gap", 9),
      ],
    },
    { id: second, next: 2, frames: [event("post_deleted", 2)] },
    { id: second, next: 3, frames: [event("notification", 3)] },
    { id: "", next: 0, frames: [hello(first)] },
  ];
  let position = 0;
  return {
    send(socket: Duplex, url: URL) {
      const step = attempts[position++];
      assert.ok(step, "unplanned account event connection");
      assert.equal(
        url.search,
        `?connection_id=${step.id}&sequence_number=${step.next}`,
      );
      for (const message of step.frames)
        socket.write(frame(JSON.stringify(message)));
      socket.write(Buffer.from([0x88, 2, 0x03, 0xe8]));
    },
    verify() {
      assert.equal(position, attempts.length);
    },
  };
}
