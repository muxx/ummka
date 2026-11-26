import assert from "node:assert/strict";
import { Configuration, PostsApi } from "../../../vendor/mattermost/index.js";
import { subscribe } from "./event-stream.ts";

type User = { token: string; id: string };
type FixturePost = (
  route: string,
  body: object,
  token?: string,
) => Promise<Response>;

export async function checkEventActions(
  base: string,
  teamId: string,
  channelId: string,
  sender: User,
  observer: User,
  create: FixturePost,
  version: string,
) {
  const posts = new PostsApi(
    new Configuration({ basePath: base, accessToken: sender.token }),
  );
  const page = await posts.getPostsForChannel({
    channelId,
    page: 0,
    perPage: 50,
  });
  const root = Object.values(page.posts ?? {}).find(
    (post) => !post.rootId && post.id,
  );
  assert.ok(
    root?.id,
    "The existing fixture channel must contain a real thread root",
  );
  const privateRoom = await create(
    "channels",
    {
      team_id: teamId,
      name: "typing-check-private",
      display_name: "Private typing fixture",
      type: "P",
    },
    observer.token,
  );
  assert.equal(privateRoom.status, 201);
  const hidden: unknown = (await privateRoom.json()).id;
  assert.ok(typeof hidden === "string" && hidden.length === 26);
  const author = subscribe(base, sender.token, "", 0);
  const peer = subscribe(base, observer.token, "", 0);
  async function acknowledge(seq: number, status: "OK" | "FAIL") {
    const response = await author.until((frame) => {
      if (frame.event === "typing")
        assert.notEqual(
          frame.data?.user_id,
          sender.id,
          "The sender received their own typing event",
        );
      return frame.seq_reply === seq;
    });
    assert.equal(response.status, status);
    return response;
  }
  try {
    await Promise.all(
      [author, peer].map((client) => client.until((f) => f.event === "hello")),
    );
    author.socket.send(JSON.stringify({ seq: 1, action: "ping" }));
    assert.equal((await acknowledge(1, "OK")).data?.text, "pong");
    for (const [seq, parent] of [
      [2, ""],
      [3, root.id],
    ] as const) {
      author.socket.send(
        JSON.stringify({
          seq,
          action: "user_typing",
          data: { channel_id: channelId, parent_id: parent },
        }),
      );
      const [ack, typed] = await Promise.all([
        acknowledge(seq, "OK"),
        peer.until((f) => f.event === "typing"),
      ]);
      assert.notEqual(ack.data?.text, "pong");
      assert.equal(typed.broadcast?.channel_id, channelId);
      assert.deepEqual(typed.data, { user_id: sender.id, parent_id: parent });
    }
    author.socket.send(
      JSON.stringify({
        seq: 4,
        action: "user_typing",
        data: { channel_id: hidden, parent_id: "" },
      }),
    );
    await acknowledge(4, "FAIL");
    // The observer belongs to both rooms. Its next typing event must be for the allowed room.
    author.socket.send(
      JSON.stringify({
        seq: 5,
        action: "user_typing",
        data: { channel_id: channelId, parent_id: "" },
      }),
    );
    const [, sentinel] = await Promise.all([
      acknowledge(5, "OK"),
      peer.until((f) => f.event === "typing"),
    ]);
    assert.equal(sentinel.broadcast?.channel_id, channelId);
    author.socket.send(JSON.stringify({ seq: 6, action: "ping" }));
    assert.equal((await acknowledge(6, "OK")).data?.text, "pong");
  } finally {
    await Promise.all([author.close(), peer.close()]);
  }
  console.log(
    `Mattermost ${version} verified application pong, channel and thread typing, excluded sender and refusal for a private channel.`,
  );
}
