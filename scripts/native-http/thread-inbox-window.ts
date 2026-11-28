import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { json, text } from "node:stream/consumers";
import { respondToAccount } from "./account.ts";
import { respondToWorkspace } from "./workspace.ts";

export function threadInboxWindowFixture(
  isAndroid: () => boolean,
  back: () => Promise<void>,
) {
  const prefix = "/inbox-window/api/v4/",
    team = "Team0123456789012345678901",
    channel = "d".repeat(26),
    me = "f".repeat(26),
    other = "j".repeat(26),
    root = "s".repeat(26);
  const make = (
    id: string,
    message: string,
    created: number,
    user: string,
  ) => ({
    id,
    user_id: user,
    channel_id: channel,
    root_id: id === root ? "" : root,
    type: "",
    hashtags: "",
    is_pinned: false,
    delete_at: 0,
    edit_at: 0,
    create_at: created,
    update_at: created,
    message,
  });
  const original = make(root, "Release **checklist**", 500, other);
  const old = make("a".repeat(26), "Earlier answer", 550, other);
  const own = make("b".repeat(26), "My later answer", 562, me);
  const fresh = make(
    "h".repeat(26),
    "A new answer from a teammate",
    563,
    other,
  );
  const visits: string[] = [];
  let viewed = 561;
  let following = true;
  async function serve(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!url.pathname.startsWith(prefix)) return false;
    const path = url.pathname.slice(prefix.length),
      query = Object.fromEntries(url.searchParams);
    const unread = following && viewed < 563 ? 1 : 0;
    const mark = `users/me/teams/${team}/threads/${root}/read/`;
    function send(body: object, label: string, method = "GET") {
      assert.equal(req.method, method);
      assert.equal(req.headers.authorization, "Bearer fixture-browser-action");
      assert.equal(req.headers.cookie, undefined);
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(body));
      visits.push(label);
    }
    if (path === "system/ping" && query.step === "inbox-hidden") {
      assert(!isAndroid());
      assert.equal(req.headers.authorization, undefined);
      assert(!visits.includes("mark"));
      assert(visits.includes("before") && visits.includes("after"));
      visits.push("hidden");
      res.writeHead(204).end();
    } else if (path === "system/ping" && query.step === "inbox-back") {
      assert.equal(req.headers.authorization, undefined);
      await back();
      res.writeHead(204).end();
      visits.push("back");
    } else if (path === "system/ping" && query.step === "inbox-verify") {
      assert.equal(req.headers.authorization, undefined);
      for (const key of [
        "follow",
        "unfollow",
        "unread",
        "destination",
        "anchor",
        "before",
        "after",
      ])
        assert.equal(visits.filter((v) => v === key).length, 1, key);
      const marked =
        isAndroid() || process.env.UMMKA_CHECK_MACOS_INBOX_FOCUS === "1";
      assert.equal(
        visits.filter((v) => v === "hidden").length,
        isAndroid() ? 0 : 1,
      );
      assert.equal(
        visits.filter((v) => v === "back").length,
        isAndroid() ? 1 : 0,
      );
      assert.equal(visits.filter((v) => v === "mark").length, marked ? 1 : 0);
      assert.equal(visits.filter((v) => v === "totals").length, marked ? 4 : 3);
      assert.equal(visits.filter((v) => v === "followed").length, 2);
      assert(
        visits.indexOf("unfollow") < visits.indexOf("follow") && following,
      );
      assert(visits.lastIndexOf("totals") > visits.indexOf("follow"));
      console.log("Authenticated inbox requests:", visits.join(", "));
      res.writeHead(204).end();
    } else if (path === `users/me/teams/${team}/threads`) {
      if (query.totalsOnly) {
        assert.deepEqual(query, { totalsOnly: "true" });
        send(
          {
            total: Number(following),
            total_unread_threads: unread,
            total_unread_mentions: 0,
            total_unread_urgent_mentions: 0,
            threads: null,
          },
          "totals",
        );
      } else {
        assert.ok(query.unread === "true" || query.unread === "false");
        assert.deepEqual(query, {
          per_page: "25",
          threadsOnly: "true",
          extended: "true",
          unread: query.unread,
        });
        send(
          {
            total: 0,
            total_unread_threads: 0,
            total_unread_mentions: 0,
            total_unread_urgent_mentions: 0,
            threads: [
              {
                id: root,
                reply_count: 3,
                last_reply_at: 563,
                last_viewed_at: viewed,
                delete_at: 0,
                unread_replies: unread,
                unread_mentions: 0,
                is_urgent: false,
                participants: [{ id: other }],
                post: original,
              },
            ].filter(() => following && (unread || query.unread === "false")),
          },
          query.unread === "true" ? "unread" : "followed",
        );
      }
    } else if (path === `users/me/teams/${team}/threads/${root}/following`) {
      const method = req.method;
      assert(method === "PUT" || method === "DELETE");
      assert.deepEqual(query, {});
      assert.equal(await text(req), "");
      following = method === "PUT";
      send({ status: "OK" }, following ? "follow" : "unfollow", method);
    } else if (path === `posts/${root}/info`) {
      send(
        {
          channel_id: channel,
          channel_type: "P",
          channel_display_name: "Design",
          has_joined_channel: true,
          team_id: team,
          team_type: "O",
          team_display_name: "Browser team",
          has_joined_team: true,
        },
        "destination",
      );
    } else if (path === `posts/${root}`) {
      send(original, "anchor");
    } else if (path === `posts/${root}/thread`) {
      const up = query.direction === "up";
      assert.deepEqual(query, {
        direction: up ? "up" : "down",
        fromCreateAt: up ? "562" : "561",
        perPage: "60",
        collapsedThreads: "true",
      });
      const rows = up ? [old] : [own, fresh],
        posts = Object.fromEntries(
          [{ ...original, is_following: following }, ...rows].map((p) => [
            p.id,
            p,
          ]),
        );
      send(
        {
          order: [root, ...rows.map((p) => p.id)],
          posts,
          first_inaccessible_post_time: 0,
          prev_post_id: "",
          next_post_id: "",
          has_next: false,
        },
        up ? "before" : "after",
      );
    } else if (path.startsWith(mark)) {
      assert.equal(await text(req), "");
      const next = Number(path.slice(mark.length));
      assert(Number.isSafeInteger(next) && next > 563);
      viewed = next;
      send(
        {
          id: root,
          last_viewed_at: viewed,
          unread_replies: 0,
          unread_mentions: 0,
        },
        "mark",
        "PUT",
      );
    } else if (path === "users/ids") {
      const ids = await json(req);
      assert(
        Array.isArray(ids) && ids.every((id) => id === me || id === other),
      );
      send(
        ids.map((id) => ({
          id,
          username: id === me ? "fixture-author" : "river",
          update_at: 100,
        })),
        "profiles",
        "POST",
      );
    } else {
      const common = new URL(url);
      common.pathname = "/browser-action-check/api/v4/" + path;
      const shared =
        (await respondToWorkspace(req, res, common, me, true)) ??
        respondToAccount(req, res, common, me, () => {});
      assert(shared, "Unhandled thread inbox request " + path);
    }
    return true;
  }
  return serve;
}
