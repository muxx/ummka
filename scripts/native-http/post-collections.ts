import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { json, text } from "node:stream/consumers";

export function collectionFixture(channelId: string, userId: string) {
  const base = "/team/chat/api/v4";
  const id = "k".repeat(26);
  const row = { id, channel_id: channelId, message: "Collection fixture" };
  const routes = new Map([
    [`${base}/channels/${channelId}/pinned`, "list-pins"],
    [`${base}/users/me/posts/flagged`, "list-saved"],
    [`${base}/posts/${id}/unpin`, "remove-pin"],
    [`${base}/users/me/preferences/delete`, "remove-saved"],
  ]);
  let pinned = true,
    saved = true;
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const action = routes.get(url.pathname);
    if (!action) return;
    assert.equal(req.headers.authorization, "Bearer fixture-prefixed-session");
    assert.equal(req.headers.cookie, undefined);
    assert.deepEqual(
      Object.fromEntries(url.searchParams),
      action === "list-saved"
        ? { page: "0", per_page: "60", channel_id: channelId }
        : {},
    );
    let body: object;
    if (action.startsWith("list-")) {
      assert.equal(req.method, "GET");
      const visible = action === "list-pins" ? pinned : saved;
      body = {
        order: visible ? [id] : [],
        posts: visible ? { [id]: row } : {},
        first_inaccessible_post_time: 0,
      };
    } else {
      assert.equal(req.method, "POST");
      if (action === "remove-pin") {
        assert.equal(await text(req), "");
        pinned = false;
      } else {
        assert.deepEqual(await json(req), [
          {
            user_id: userId,
            category: "flagged_post",
            name: id,
            value: "true",
          },
        ]);
        saved = false;
      }
      body = { status: "OK" };
    }
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(body));
    return action;
  };
}
