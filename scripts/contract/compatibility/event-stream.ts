import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { on, once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import {
  CommandsApi,
  type Configuration,
  PostsApi,
} from "../../../vendor/mattermost/index.js";

type FixtureFrame = {
  event?: string;
  seq?: number;
  data?: { connection_id?: string; post?: string };
  broadcast?: { channel_id?: string };
  seq_reply?: number;
  status?: string;
};

class ReplacementHello extends Error {}

// Node's built-in client accepts HTTP Upgrade headers as well as subprotocols.
const NodeWebSocket = WebSocket as typeof WebSocket & {
  new (url: string, init: { headers: { Authorization: string } }): WebSocket;
};

function subscribe(
  base: string,
  token: string,
  id: string,
  nextSequence: number,
) {
  const url = new URL("/api/v4/websocket", base);
  url.protocol = "ws:";
  url.searchParams.set("connection_id", id);
  url.searchParams.set("sequence_number", String(nextSequence));
  const socket = new NodeWebSocket(url.href, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const signal = AbortSignal.timeout(30_000);
  const frames = on(socket, "message", { signal, close: ["close"] });
  let expected = nextSequence;
  return {
    socket,
    get nextSequence() {
      return expected;
    },
    async until(matches: (frame: FixtureFrame) => boolean) {
      for (;;) {
        const next = await frames.next();
        assert.ok(
          !next.done,
          "The socket closed before the expected fixture event",
        );
        const frame: FixtureFrame = JSON.parse(next.value[0].data);
        if (frame.event !== undefined) {
          assert.ok(frame.data && frame.broadcast);
          assert.equal(frame.seq_reply, undefined);
          assert.equal(frame.status, undefined);
          const replacement = frame.data?.connection_id;
          if (
            expected === nextSequence &&
            nextSequence > 0 &&
            frame.event === "hello" &&
            frame.seq === 0 &&
            typeof replacement === "string" &&
            /^[a-z0-9]{26}$/.test(replacement) &&
            replacement !== id
          ) {
            throw new ReplacementHello("Mattermost returned a new event queue");
          }
          assert.equal(
            frame.seq,
            expected,
            "Discontinuous Mattermost event sequence",
          );
          expected++;
        } else {
          assert.ok(
            frame.seq_reply && ["OK", "FAIL"].includes(frame.status ?? ""),
          );
        }
        if (matches(frame)) return frame;
      }
    },
    async close() {
      try {
        if (socket.readyState !== NodeWebSocket.CLOSED) {
          const closed = once(socket, "close", { signal });
          socket.close();
          await closed;
        }
      } finally {
        await frames.return?.();
      }
    },
  };
}

// A completed client close handshake can precede HubUnregister. Both tested
// servers resume only inactive queues. A new hello never satisfies a replay.
async function resumeUntil(
  base: string,
  token: string,
  id: string,
  nextSequence: number,
  matches: (frame: FixtureFrame) => boolean,
  onReplacement?: () => Promise<void>,
) {
  const deadline = performance.now() + 3_000;
  for (;;) {
    const stream = subscribe(base, token, id, nextSequence);
    try {
      return { stream, frame: await stream.until(matches) };
    } catch (error) {
      await stream.close();
      if (!(error instanceof ReplacementHello) || performance.now() >= deadline)
        throw error;
      await onReplacement?.();
      await delay(25);
    }
  }
}

export async function checkEventStream(
  base: string,
  token: string,
  session: Configuration,
  userId: string,
  teamId: string,
  channelId: string,
) {
  const posts = new PostsApi(session);
  const createPost = (message: string, pendingPostId?: string) =>
    posts.createPost({
      createPostRequest: { channelId, message, pendingPostId },
    });
  const containsPost = (id: string) => (frame: FixtureFrame) =>
    frame.event === "posted" &&
    typeof frame.data?.post === "string" &&
    JSON.parse(frame.data.post).id === id;
  const first = subscribe(base, token, "", 0);
  let connectionId: string;
  try {
    const hello = await first.until(() => true);
    assert.equal(hello.event, "hello");
    const id = hello.data?.connection_id;
    assert.ok(id);
    assert.match(id, /^[a-z0-9]{26}$/);
    connectionId = id;
    const pendingPostId = `${userId}:${randomUUID()}`;
    const post = await createPost("Event stream fixture", pendingPostId);
    assert.ok(post.id);
    const posted = await first.until(containsPost(post.id));
    assert.equal(posted.broadcast?.channel_id, channelId);
    assert.ok(posted.data?.post);
    const wire = JSON.parse(posted.data.post);
    assert.equal(wire.id, post.id);
    assert.equal(wire.user_id, userId);
    assert.equal(wire.channel_id, channelId);
    assert.equal(wire.root_id, "");
    assert.equal(wire.pending_post_id, pendingPostId);
    const help = await new CommandsApi(session).executeCommand({
      executeCommandRequest: { channelId, teamId, command: "/help" },
    });
    const privateReply = await first.until(
      (frame) =>
        frame.event === "ephemeral_message" &&
        typeof frame.data?.post === "string" &&
        JSON.parse(frame.data.post).message === help.text,
    );
    assert.equal(
      JSON.parse(privateReply.data?.post ?? "{}").channel_id,
      channelId,
    );
    first.socket.send(JSON.stringify({ seq: 1, action: "ping", data: {} }));
    const ack = await first.until((frame) => frame.seq_reply === 1);
    assert.equal(ack.status, "OK");
  } finally {
    await first.close();
  }
  const missed = await createPost("Created between socket connections");
  assert.ok(missed.id);
  const match = containsPost(missed.id);
  const { stream: resumed, frame: delivered } = await resumeUntil(
    base,
    token,
    connectionId,
    first.nextSequence,
    match,
  );
  try {
    assert.equal(delivered.broadcast?.channel_id, channelId);
    assert.ok(typeof delivered.seq === "number");
    // Keep the preceding connection alive until the server confirms it cannot
    // resume that queue yet. Then replay the same uncommitted post and sequence.
    let replaced = false;
    const { stream: replay, frame: repeated } = await resumeUntil(
      base,
      token,
      connectionId,
      delivered.seq,
      match,
      async () => {
        if (!replaced) {
          replaced = true;
          await resumed.close();
        }
      },
    );
    try {
      assert.equal(
        replaced,
        true,
        "The active queue was not held during the check",
      );
      assert.equal(repeated.seq, delivered.seq);
      assert.equal(repeated.broadcast?.channel_id, channelId);
    } finally {
      await replay.close();
    }
  } finally {
    await resumed.close();
  }
}
