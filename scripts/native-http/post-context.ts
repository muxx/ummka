import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export function respondToPostContext(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  channelId: string,
  teamId: string,
): string | undefined {
  const post = "p".repeat(26);
  const route = `/api/v4/posts/${post}/info`;
  const prefixed = url.pathname === `/team/chat${route}`;
  if (!prefixed && url.pathname !== route) return;
  assert.equal(request.method, "GET");
  assert.equal(request.headers.cookie, undefined);
  assert.equal(
    request.headers.authorization,
    prefixed
      ? "Bearer fixture-prefixed-session"
      : "Bearer fixture-root-session",
  );
  assert.equal(url.search, "");
  response.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      channel_id: channelId,
      channel_type: prefixed ? "D" : "O",
      channel_display_name: prefixed ? "" : "Town Square",
      has_joined_channel: true,
      team_id: prefixed ? "" : teamId,
      team_type: prefixed ? "" : "O",
      team_display_name: prefixed ? "" : "Fixture",
      has_joined_team: !prefixed,
    }),
  );
  return prefixed ? "post-info-prefixed" : "post-info-root";
}
