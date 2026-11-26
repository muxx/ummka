import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export async function respondToChannelView(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  channel: string,
  teamId: string,
  userId: string,
) {
  const single = "/api/v4/channels/members/me/view";
  const bulk = "/team/chat/api/v4/channels/members/me/mark_read";
  const unread = `/team/chat/api/v4/users/me/posts/${"p".repeat(26)}/set_unread`;
  if (![single, bulk, unread].includes(url.pathname)) return;
  const prefix = url.pathname !== single;
  assert.equal(request.method, "POST");
  assert.equal(
    request.headers.authorization,
    prefix ? "Bearer fixture-prefixed-session" : "Bearer fixture-root-session",
  );
  assert.equal(request.headers.cookie, undefined);
  assert.equal(request.headers["content-type"], "application/json");
  assert.equal(url.search, "");
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const other = "v".repeat(26);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (url.pathname === unread) {
    assert.deepEqual(body, { collapsed_threads_supported: true });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        user_id: userId,
        team_id: teamId,
        channel_id: channel,
        msg_count: 27,
        mention_count: 7,
        msg_count_root: 24,
        mention_count_root: 3,
        urgent_mention_count: 2,
        last_viewed_at: 110,
      }),
    );
    return "set-post-unread";
  }
  if (url.pathname === single && body?.channel_id === "") {
    assert.deepEqual(body, {
      channel_id: "",
      collapsed_threads_supported: true,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "OK", last_viewed_at_times: {} }));
    return "clear-channel-view";
  }
  assert.deepEqual(
    body,
    prefix
      ? [channel, other]
      : { channel_id: channel, collapsed_threads_supported: true },
  );
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      status: "OK",
      last_viewed_at_times: prefix
        ? { [channel]: 123, [other]: 126 }
        : { [channel]: 121 },
    }),
  );
  return prefix ? "bulk-channel-view" : "single-channel-view";
}
