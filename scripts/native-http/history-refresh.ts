import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export function historyRefreshFixture(userId: string, onHold: () => void) {
  const channel = "w".repeat(26),
    root = "k".repeat(26),
    reply = "l".repeat(26),
    old = "m".repeat(26),
    cursor = "x".repeat(26);
  const path = "/team/chat/api/v4";
  const calls: string[] = [];
  let delayed: ServerResponse | undefined;
  function record(id: string, at: number, parent = "") {
    return {
      id,
      channel_id: channel,
      user_id: userId,
      root_id: parent,
      create_at: at,
      update_at: at,
      edit_at: 0,
      delete_at: 0,
      type: "",
      message: `Refresh ${id}`,
      hashtags: "",
      is_pinned: false,
    };
  }
  const records = {
    [reply]: record(reply, 300, root),
    [root]: record(root, 200),
    [old]: record(old, 100),
  };
  function page(
    res: ServerResponse,
    order: string[],
    prev: string,
    next: string,
    ids = order,
  ) {
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        order,
        posts: Object.fromEntries(ids.map((id) => [id, records[id]])),
        prev_post_id: prev,
        next_post_id: next,
        first_inaccessible_post_time: 0,
      }),
    );
  }
  return {
    handle(req: IncomingMessage, res: ServerResponse, url: URL) {
      const thread = url.pathname === `${path}/posts/${root}/thread`;
      if (!thread && url.pathname !== `${path}/channels/${channel}/posts`)
        return false;
      assert.equal(req.method, "GET");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      const q = url.searchParams;
      if (thread && q.get("direction") === "up") {
        assert.deepEqual(Object.fromEntries(q), {
          direction: "up",
          perPage: "1",
          collapsedThreads: "true",
          fromPost: cursor,
          fromCreateAt: "400",
        });
        calls.push("replies");
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            order: [root, reply],
            posts: { [root]: records[root], [reply]: records[reply] },
            has_next: false,
          }),
        );
      } else if (thread && q.get("perPage") === "1") {
        assert.deepEqual(Object.fromEntries(q), {
          direction: "down",
          perPage: "1",
          collapsedThreads: "false",
        });
        calls.push("flat-root");
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            order: [root],
            posts: { [root]: records[root] },
            has_next: false,
          }),
        );
      } else if (thread) {
        assert.equal(q.get("perPage"), "60");
        assert.equal(q.get("direction"), "down");
        calls.push("thread");
        page(res, [root, reply], "", "");
      } else if (q.get("since") === "3") {
        calls.push("error");
        res.writeHead(503, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            id: "fixture.unavailable",
            message: "Retry",
            status_code: 503,
          }),
        );
      } else if (q.get("since") === "2") {
        assert(delayed);
        calls.push("remove");
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            order: [old],
            posts: {
              [old]: { ...records[old], delete_at: 400, update_at: 400 },
            },
          }),
        );
      } else if (q.get("before") === cursor) {
        assert.equal(delayed, undefined);
        calls.push("delayed");
        delayed = res;
        onHold();
      } else if (q.get("before") === root) {
        assert.equal(q.get("per_page"), "30");
        calls.push("before");
        page(res, [old], "", root);
      } else if (q.get("after") === root) {
        assert.equal(q.get("per_page"), "30");
        calls.push("after");
        page(res, [reply], root, "");
      } else {
        assert.equal(q.get("per_page"), "60");
        const collapsed = q.get("collapsedThreads") === "true";
        calls.push(collapsed ? "collapsed" : "plain");
        page(res, collapsed ? [root, old] : [reply, root, old], "", "", [
          reply,
          root,
          old,
        ]);
      }
      return true;
    },
    release() {
      assert(delayed);
      page(delayed, [old], "", cursor);
      delayed = undefined;
    },
    verify() {
      assert.equal(delayed, undefined);
      assert.deepEqual(
        calls.sort(),
        [
          "plain",
          "replies",
          "flat-root",
          "collapsed",
          "thread",
          "before",
          "after",
          "error",
          "delayed",
          "remove",
        ].sort(),
      );
    },
  };
}
