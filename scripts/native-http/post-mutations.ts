import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export async function respondToPostMutation(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  channel: string,
  user: string,
) {
  const root = "v".repeat(26);
  const replyId = "j".repeat(26);
  const replyPath = `/team/chat/api/v4/posts/${replyId}`;
  if (url.pathname === replyPath || url.pathname === `${replyPath}/patch`) {
    const patch = url.pathname.endsWith("/patch");
    assert.equal(req.method, patch ? "PUT" : "DELETE");
    assert.equal(req.headers.authorization, "Bearer fixture-prefixed-session");
    assert.equal(req.headers.cookie, undefined);
    assert.equal(url.search, "");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (patch) {
      assert.equal(req.headers["content-type"], "application/json");
      const expected = { message: "Отредактировано ✎", props: { note: true } };
      assert.deepEqual(JSON.parse(body.toString("utf8")), expected);
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          id: replyId,
          root_id: root,
          user_id: user,
          channel_id: channel,
          ...expected,
        }),
      );
      return "patch-post";
    }
    assert.equal(body.length, 0);
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ status: "OK" }));
    return "delete-post";
  }
  const path = "/api/v4/posts";
  const prefix = url.pathname === "/team/chat" + path;
  if (!prefix && url.pathname !== path) return;
  assert.equal(req.method, "POST");
  assert.equal(
    req.headers.authorization,
    prefix ? "Bearer fixture-prefixed-session" : "Bearer fixture-root-session",
  );
  assert.equal(req.headers.cookie, undefined);
  assert.equal(req.headers["content-type"], "application/json");
  assert.equal(url.search, prefix ? "?set_online=false" : "");
  const expected = {
    channel_id: channel,
    message: prefix ? "Ответ 👋\nв треде" : "Root **text**",
    ...(prefix && { root_id: root }),
    pending_post_id: prefix ? "fixture:reply" : "fixture:root",
  };
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  assert.deepEqual(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
    expected,
  );
  res.writeHead(201, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      ...expected,
      id: prefix ? "j".repeat(26) : root,
      user_id: user,
    }),
  );
  return prefix ? "create-post-reply" : "create-post-root";
}
