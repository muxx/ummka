import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export async function respondToChannelMembers(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  channelId: string,
  userId: string,
) {
  const route = `/api/v4/channels/${channelId}/members`;
  const self = url.pathname === `${route}/me`;
  const single = url.pathname === `/team/chat${route}/${userId}`;
  const page = url.pathname === route;
  const batch = url.pathname === `/team/chat${route}/ids`;
  const add = url.pathname === `/team/chat${route}`;
  const remove = single && request.method === "DELETE";
  if (!self && !single && !page && !batch && !add) return;
  assert.equal(
    request.method,
    add || batch ? "POST" : remove ? "DELETE" : "GET",
  );
  assert.equal(url.search, page ? "?page=2&per_page=3" : "");
  assert.equal(request.headers.cookie, undefined);
  assert.equal(
    request.headers.authorization,
    self || page
      ? "Bearer fixture-root-session"
      : "Bearer fixture-prefixed-session",
  );
  const member = {
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
  };
  const other = "v".repeat(26);
  if (remove) {
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ status: "OK" }));
    return "member-remove";
  }
  if (batch || add) {
    assert.equal(request.headers["content-type"], "application/json");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    assert.equal(
      Buffer.concat(chunks).toString("utf8"),
      JSON.stringify(
        add
          ? { user_id: userId, post_root_id: "r".repeat(26) }
          : [other, userId],
      ),
    );
  }
  const payload = page
    ? [member]
    : batch
      ? [member, { ...member, user_id: other }]
      : member;
  response
    .writeHead(add ? 201 : 200, { "Content-Type": "application/json" })
    .end(JSON.stringify(payload));
  if (add) return "member-add";
  if (page) return "members-page";
  if (batch) return "members-batch";
  return self ? "member-self" : "member-id";
}
