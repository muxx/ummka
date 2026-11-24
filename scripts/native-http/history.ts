import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export function respondToHistory(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  channelId: string,
  userId: string,
): string | undefined {
  const route = `/api/v4/channels/${channelId}/posts`;
  const prefix = url.pathname === `/team/chat${route}`;
  if (url.pathname !== route && !prefix) return;
  assert.equal(request.method, "GET");
  assert.equal(request.headers.cookie, undefined);
  const root = "r".repeat(26);
  const reply = "p".repeat(26);
  const query = Object.fromEntries(url.searchParams);
  assert.equal(url.searchParams.size, Object.keys(query).length);
  if (!request.headers.authorization) {
    assert.equal(prefix, false);
    assert.deepEqual(query, {});
    response
      .writeHead(401, { "Content-Type": "application/json" })
      .end(JSON.stringify({ message: "session required" }));
    return "history-anonymous";
  }
  assert.equal(request.headers.authorization, "Bearer synthetic-session");
  assert.deepEqual(
    query,
    prefix
      ? {
          before: reply,
          per_page: "2",
          skipFetchThreads: "false",
          collapsedThreads: "true",
          collapsedThreadsExtended: "true",
        }
      : { page: "0", per_page: "2" },
  );
  const rootPost = {
    id: root,
    channel_id: channelId,
    message: "Root",
    reply_count: 1,
    last_reply_at: 2200,
    participants: prefix ? [{ id: userId, username: "fixture" }] : null,
    is_following: false,
    metadata: {
      images: {
        "https://image.example.test/post.png": {
          width: 4,
          height: 3,
          format: "png",
          frame_count: 0,
        },
      },
    },
  };
  const replyPost = {
    id: reply,
    root_id: root,
    channel_id: channelId,
    message: "Reply",
  };
  response.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      order: prefix ? [root] : [reply, root],
      posts: prefix
        ? { [root]: rootPost }
        : { [root]: rootPost, [reply]: replyPost },
      prev_post_id: root,
      next_post_id: "",
      has_next: false,
      first_inaccessible_post_time: prefix ? 1800 : 0,
    }),
  );
  return prefix ? "history-prefixed" : "history-root";
}
