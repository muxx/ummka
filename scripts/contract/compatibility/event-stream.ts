import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { on, once } from "node:events";
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
          assert.equal(
            frame.seq,
            expected,
            "Discontinuous Mattermost event sequence",
          );
          expected++;
          assert.ok(frame.data && frame.broadcast);
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
  const resumed = subscribe(base, token, connectionId, first.nextSequence);
  try {
    const delivered = await resumed.until(containsPost(missed.id));
    assert.equal(delivered.broadcast?.channel_id, channelId);
  } finally {
    await resumed.close();
  }
}
