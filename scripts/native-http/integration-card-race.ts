import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

const channel = "2".repeat(26);
const root = "3".repeat(26);
const reply = "4".repeat(26);
const unknownRoot = "5".repeat(26);

export function integrationCardRaceFixture(
  userId: string,
  reportHeld: (name: string) => void,
) {
  const prefix = "/team/chat/api/v4";
  const held = new Map<string, () => void>();
  const calls: string[] = [];
  let rootReads = 0;
  function post(id: string, updateAt: number, title: string | null) {
    return {
      id,
      channel_id: channel,
      user_id: userId,
      root_id: id === reply ? root : "",
      create_at: id === root ? 5 : 8,
      update_at: updateAt,
      edit_at: 0,
      delete_at: 0,
      type: "",
      message: "fixture body",
      hashtags: "",
      is_pinned: false,
      props: { attachments: title ? [{ title }] : null },
      metadata: { embeds: [{ type: "message_attachment" }] },
    };
  }
  const page = (version: number, title: string, replyTitle: string | null) => ({
    order: [root, reply],
    posts: {
      [root]: post(root, version, title),
      [reply]: post(reply, 10, replyTitle),
    },
    has_next: false,
  });
  return {
    handle(req: IncomingMessage, res: ServerResponse, url: URL) {
      const path = url.pathname;
      if (
        path !== `${prefix}/posts/${root}` &&
        path !== `${prefix}/posts/${reply}` &&
        path !== `${prefix}/posts/${root}/thread` &&
        path !== `${prefix}/posts/${unknownRoot}` &&
        path !== `${prefix}/posts/${unknownRoot}/thread` &&
        path !== `${prefix}/channels/${channel}/posts`
      )
        return false;
      assert.equal(req.method, "GET");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      function send(value: object) {
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify(value));
      }
      function hold(name: string, value: object) {
        assert(!held.has(name));
        calls.push(name);
        held.set(name, () => send(value));
        reportHeld(name);
      }
      if (path === `${prefix}/posts/${unknownRoot}`) {
        hold("card-race-first", post(unknownRoot, 20, "old first GET"));
      } else if (path === `${prefix}/posts/${unknownRoot}/thread`) {
        calls.push("first-thread");
        send({
          order: [unknownRoot],
          posts: { [unknownRoot]: post(unknownRoot, 30, "first thread wins") },
          has_next: false,
        });
      } else if (path.endsWith("/thread")) {
        switch (url.searchParams.get("perPage")) {
          case "1":
            calls.push("seed");
            send(page(10, "seed root", "seed reply"));
            break;
          case "2":
            hold("card-race-thread", page(10, "stale root", "stale reply"));
            break;
          case "3":
            calls.push("thread-wins");
            send(page(30, "thread wins", null));
            break;
          default:
            assert.fail("Unexpected integration card thread request");
        }
      } else if (path.endsWith(reply)) {
        calls.push("clear-reply");
        send(post(reply, 10, null));
      } else if (path.endsWith(root)) {
        switch (++rootReads) {
          case 1:
            calls.push("point-wins");
            send(post(root, 20, "point wins"));
            break;
          case 2:
            hold("card-race-point", post(root, 20, "stale point"));
            break;
          case 3:
            hold("card-race-delete", post(root, 30, "deleted card"));
            break;
          default:
            assert.fail("Unexpected integration card point request");
        }
      } else {
        assert.equal(url.searchParams.get("since"), "30");
        calls.push("delete-post");
        send({
          order: [],
          posts: { [root]: { ...post(root, 40, null), delete_at: 40 } },
        });
      }
      return true;
    },
    release(name: string) {
      const send = held.get(name);
      assert(send);
      held.delete(name);
      send();
    },
    verify() {
      assert.equal(held.size, 0);
      assert.deepEqual(calls, [
        "seed",
        "card-race-thread",
        "point-wins",
        "clear-reply",
        "card-race-point",
        "thread-wins",
        "card-race-delete",
        "delete-post",
        "card-race-first",
        "first-thread",
      ]);
    },
  };
}
