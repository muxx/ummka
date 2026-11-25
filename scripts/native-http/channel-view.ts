import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export async function respondToChannelView(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  channel: string,
) {
  const single = "/api/v4/channels/members/me/view";
  const bulk = "/team/chat/api/v4/channels/members/me/mark_read";
  if (url.pathname !== single && url.pathname !== bulk) return;
  const prefix = url.pathname === bulk;
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
  assert.deepEqual(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
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
