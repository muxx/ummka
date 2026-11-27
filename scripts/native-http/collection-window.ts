import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { json as requestJson } from "node:stream/consumers";
import { respondToAccount } from "./account.ts";
import { respondToWorkspace } from "./workspace.ts";

export function collectionWindowFixture() {
  const team = "Team0123456789012345678901",
    channel = "c".repeat(26),
    user = "f".repeat(26);
  const root = "v".repeat(26),
    reply = "w".repeat(26);
  const outside = "j".repeat(26),
    outsidePost = "y".repeat(26);
  const oldest = "oldest".padEnd(26, "0");
  const raw = [
    reply,
    root,
    ...Array.from({ length: 118 }, (_, i) => String(i + 1).padStart(26, "0")),
    oldest,
  ];
  const hidden = new Set(raw.slice(60, 120));
  let pinned = true;
  let markBoundary!: () => void;
  const boundaryArrived = new Promise<void>((resolve) => {
    markBoundary = resolve;
  });
  let releasePrevious: (() => void) | undefined;
  const offsets: number[] = [];
  const item = (id: string) => ({
    id,
    user_id: user,
    channel_id: channel,
    root_id: id === reply ? root : "",
    type: "",
    hashtags: "",
    is_pinned: id === root && pinned,
    delete_at: 0,
    edit_at: 0,
    create_at: id === reply ? 561 : id === root ? 560 : 1,
    update_at: id === reply ? 561 : id === root ? 560 : 1,
    message:
      id === reply
        ? "Reply visible only inside Town’s thread for @reader"
        : id === root
          ? "Town fixture message"
          : id === oldest
            ? "Oldest **saved**\n\n- window\n- [result](https://example.test/oldest)"
            : "Saved fixture " + id.slice(-3),
  });
  function posts(ids: string[]) {
    return {
      order: ids,
      posts: Object.fromEntries(ids.map((id) => [id, item(id)])),
      first_inaccessible_post_time: 0,
      prev_post_id: "",
      next_post_id: "",
    };
  }
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const prefix = "/collection-window/api/v4/";
    if (!url.pathname.startsWith(prefix)) return;
    const path = url.pathname.slice(prefix.length);
    const common = new URL(url);
    common.pathname = "/browser-action-check/api/v4/" + path;
    const send = (value: unknown, method = "GET") => {
      assert.equal(req.headers.authorization, "Bearer fixture-browser-action");
      assert.equal(req.headers.cookie, undefined);
      assert.equal(req.method, method);
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(value));
    };
    if (path === "system/ping" && url.searchParams.get("step") === "boundary") {
      assert.equal(req.method, "GET");
      assert.equal(req.headers.authorization, undefined);
      await boundaryArrived;
      res.writeHead(204).end();
      return true;
    }
    if (path === "users/me") {
      send({
        id: user,
        username: "reader",
        roles: "system_user",
        notify_props: { channel: "false", mention_keys: "" },
        timezone: { useAutomaticTimezone: "false", manualTimezone: "UTC" },
      });
    } else if (path === "posts/search") {
      const query = await requestJson(req);
      assert(query && typeof query === "object" && "page" in query);
      assert.deepEqual(query, {
        terms: '"@reader"',
        is_or_search: true,
        per_page: 20,
        page: query.page,
        include_deleted_channels: true,
        time_zone_offset: 0,
      });
      assert(query.page === 0 || query.page === 1);
      const page = posts(query.page === 0 ? [reply, outsidePost] : []);
      if (query.page === 0) {
        page.posts[outsidePost].channel_id = outside;
        page.posts[outsidePost].message = "Release notes mention @reader";
      }
      send({ ...page, matches: {} }, "POST");
    } else if (path === `channels/${outside}`) {
      send({
        id: outside,
        type: "P",
        team_id: "s".repeat(26),
        name: "releases",
        display_name: "Outside releases",
        delete_at: 0,
      });
    } else if (path === "users/me/preferences") {
      send(
        raw.map((name) => ({
          user_id: user,
          category: "flagged_post",
          name,
          value: "true",
        })),
      );
    } else if (path === "users/me/posts/flagged") {
      const offset = Number(url.searchParams.get("page"));
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        page: String(offset),
        per_page: "60",
      });
      const page = raw
        .slice(offset, offset + 60)
        .filter((id) => !hidden.has(id));
      offsets.push(offset);
      const result = posts(page);
      if (offset === 60) {
        releasePrevious = () => {
          if (!res.destroyed) send(result);
        };
        markBoundary();
      } else {
        if (offset === 59) {
          releasePrevious?.();
          releasePrevious = undefined;
        }
        if (offset === 119) assert.deepEqual(offsets, [0, 60, 59, 119]);
        send(result);
      }
    } else if (path === "users/me/preferences/delete") {
      const changes = await requestJson(req);
      assert(Array.isArray(changes));
      assert.equal(changes.length, 1);
      const id = changes[0].name;
      assert.deepEqual(changes, [
        { user_id: user, category: "flagged_post", name: id, value: "true" },
      ]);
      const index = raw.indexOf(id);
      assert(index >= 0 && index < 60 && !hidden.has(id));
      raw.splice(index, 1);
      send({ status: "OK" }, "POST");
    } else if (path === `channels/${channel}/pinned`) {
      send(posts(pinned ? [root] : []));
    } else if (path === `posts/${root}/unpin`) {
      pinned = false;
      send({ status: "OK" }, "POST");
    } else if (path === `posts/${reply}/info`) {
      send({
        channel_id: channel,
        channel_type: "O",
        channel_display_name: "Town Square",
        has_joined_channel: true,
        team_id: team,
        team_type: "O",
        team_display_name: "Browser team",
        has_joined_team: true,
      });
    } else if (path === `posts/${reply}`) {
      send(item(reply));
    } else if (
      path === `channels/${channel}/posts` &&
      (url.searchParams.has("before") || url.searchParams.has("after"))
    ) {
      const anchor =
        url.searchParams.get("before") ?? url.searchParams.get("after");
      assert.equal(anchor, root);
      send(posts([]));
    } else if (path === `posts/${root}/thread`) {
      assert.equal(url.searchParams.get("perPage"), "60");
      assert.equal(url.searchParams.get("collapsedThreads"), "true");
      assert(["up", "down"].includes(url.searchParams.get("direction") ?? ""));
      if (url.searchParams.has("fromPost")) {
        assert.equal(url.searchParams.get("fromPost"), reply);
        assert.equal(url.searchParams.get("fromCreateAt"), "561");
        send({ ...posts([root]), has_next: false });
      } else send({ ...posts([root, reply]), has_next: false });
    } else if (path === "roles/names") {
      const names = await requestJson(req);
      assert(Array.isArray(names) && names.includes("channel_user"));
      send(
        names.map((name) => ({
          name,
          permissions:
            name === "channel_user"
              ? ["create_post", "read_channel_content"]
              : [],
        })),
        "POST",
      );
    } else {
      const served =
        (await respondToWorkspace(req, res, common, user, false)) ??
        respondToAccount(req, res, common, user, () => {});
      assert(served, "Missing collection window fixture " + path);
    }
    return true;
  };
}
