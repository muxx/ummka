import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export function respondToGroupAudience(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  channelId: string,
) {
  const route = `/api/v4/channels/${channelId}/member_counts_by_group`;
  const withZones = url.pathname === `/team/chat${route}`;
  if (!withZones && url.pathname !== route) return;
  assert.equal(request.method, "GET");
  assert.equal(request.headers.cookie, undefined);
  assert.equal(
    request.headers.authorization,
    withZones
      ? "Bearer fixture-prefixed-session"
      : "Bearer fixture-root-session",
  );
  assert.equal(url.search, withZones ? "?include_timezones=true" : "");
  const groups = withZones
    ? [
        {
          group_id: "g".repeat(26),
          channel_member_count: 3,
          channel_member_timezones_count: 2,
        },
        {
          group_id: "h".repeat(26),
          channel_member_count: 1,
          channel_member_timezones_count: 0,
        },
      ]
    : [];
  response
    .writeHead(200, { "Content-Type": "application/json" })
    .end(JSON.stringify(groups));
  return withZones ? "group-audience-timezones" : "group-audience-empty";
}
