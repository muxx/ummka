import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export function respondToChannelMember(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  channelId: string,
  userId: string,
) {
  const route = `/api/v4/channels/${channelId}/members/`;
  const root = url.pathname === route + "me";
  if (!root && url.pathname !== "/team/chat" + route + userId) return;
  assert.equal(request.method, "GET");
  assert.equal(url.search, "");
  assert.equal(request.headers.cookie, undefined);
  assert.equal(
    request.headers.authorization,
    root ? "Bearer fixture-root-session" : "Bearer fixture-prefixed-session",
  );
  response.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      user_id: userId,
      channel_id: channelId,
      roles: "channel_user",
      scheme_user: true,
      last_viewed_at: 101,
      msg_count: 18,
      msg_count_root: 13,
      mention_count: 6,
      mention_count_root: 3,
      urgent_mention_count: 2,
      notify_props: { mark_unread: "mention" },
    }),
  );
  return root ? "member-self" : "member-id";
}
