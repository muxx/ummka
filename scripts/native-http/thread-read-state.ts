import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { text } from "node:stream/consumers";

export async function respondToThreadRead(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  teamId: string,
) {
  const prefix = `/team/chat/api/v4/users/me/teams/${teamId}/threads`;
  const root = "p".repeat(26);
  const timestamp = 1700000000123;
  const single = url.pathname === `${prefix}/${root}/read/${timestamp}`;
  if (!single && url.pathname !== `${prefix}/read`) return;
  assert.equal(req.method, "PUT");
  assert.equal(url.search, "");
  assert.equal(req.headers.authorization, "Bearer fixture-prefixed-session");
  assert.equal(req.headers.cookie, undefined);
  assert.equal(await text(req), "");
  const result = single
    ? {
        id: root,
        post: { id: root },
        last_viewed_at: timestamp,
        unread_replies: 3,
        unread_mentions: 2,
      }
    : { status: "OK" };
  res
    .writeHead(200, { "Content-Type": "application/json" })
    .end(JSON.stringify(result));
  return single ? "read-thread" : "read-team-threads";
}
