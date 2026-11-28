import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { json as readJson } from "node:stream/consumers";
import { eventTextFrame, upgradeEventSocket } from "./event-socket.ts";

const base = "/team/chat/secondary/api/v4/";
const member = "b".repeat(26),
  peer = "p".repeat(26),
  team = "t".repeat(26),
  channel = "c".repeat(26),
  otherChannel = "j".repeat(26);
const one = "a".repeat(26),
  two = "z".repeat(26),
  reply = "q".repeat(26);
const endpoint = `${base}websocket`;
function row(id: string, message: string, root = "") {
  return {
    id,
    channel_id: channel,
    user_id: peer,
    root_id: root,
    type: "",
    hashtags: "",
    is_pinned: false,
    create_at: 100,
    update_at: 100,
    edit_at: 0,
    delete_at: 0,
    message,
  };
}
export function openChannelEventFixture() {
  const rows = new Map<string, ReturnType<typeof row>>();
  const removedAt = new Map<string, number>();
  let active = false,
    collapsed = true,
    seq = 0,
    reads = 0,
    initialReads = 0;
  let socket: Duplex | undefined;
  const completed: string[] = [];
  const frames: Buffer[] = [];
  let resumed = 0;
  let exactReads = 0;
  let lastMode: boolean | undefined;
  let respond: (() => void) | undefined;
  let awaiting = false;
  let cancelled = false;
  function emit(kind: string, post: ReturnType<typeof row>) {
    frames.push(
      eventTextFrame(
        JSON.stringify({
          event: kind,
          seq: ++seq,
          broadcast: { channel_id: channel },
          data: { post: JSON.stringify(post) },
        }),
      ),
    );
    socket?.write(frames[frames.length - 1]);
  }
  async function until(check: () => boolean, detail: string) {
    const until = Date.now() + 5000;
    while (!check()) {
      assert(Date.now() < until, detail);
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  }
  function list(ids: string[]) {
    const objects = Object.fromEntries(
      ids.map((id) => {
        const post = rows.get(id);
        assert(post);
        const replies = [...rows.values()].filter((row) => row.root_id === id);
        return [
          id,
          {
            ...post,
            reply_count: replies.length,
            last_reply_at: replies.length ? 100 : 0,
            participants: [],
          },
        ];
      }),
    );
    return {
      order: ids,
      posts: objects,
      prev_post_id: "",
      next_post_id: "",
      first_inaccessible_post_time: 0,
    };
  }
  return {
    upgrade(req: IncomingMessage, peerSocket: Duplex) {
      const url = new URL(req.url ?? "/", "https://fixture.test");
      const { pathname } = url;
      if (pathname === "/browser-action-check/api/v4/websocket") {
        assert.equal(
          req.headers.authorization,
          "Bearer fixture-browser-action",
        );
        assert.equal(req.headers.cookie, undefined);
        upgradeEventSocket(req, peerSocket);
        peerSocket.write(
          eventTextFrame(
            JSON.stringify({
              event: "hello",
              seq: 0,
              data: { connection_id: "l".repeat(26) },
              broadcast: {},
            }),
          ),
        );
        return true;
      }
      if (pathname !== endpoint) return false;
      assert(active);
      peerSocket.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "ECONNRESET") throw error;
      });
      assert.equal(req.headers.authorization, "Bearer fixture-second-session");
      assert.equal(req.headers.cookie, undefined);
      upgradeEventSocket(req, peerSocket);
      socket = peerSocket;
      peerSocket.once("close", () => {
        if (socket === peerSocket) socket = undefined;
      });
      const queue = "e".repeat(26);
      const from = Number(url.searchParams.get("sequence_number"));
      if (url.searchParams.get("connection_id") === queue) {
        assert(from > 0 && from <= frames.length + 1);
        if (from <= frames.length) resumed++;
        for (const frame of frames.slice(from - 1)) peerSocket.write(frame);
      } else {
        assert.equal(from, 0);
        assert.equal(frames.length, 0);
        peerSocket.write(
          eventTextFrame(
            JSON.stringify({
              event: "hello",
              seq: 0,
              data: { connection_id: queue },
              broadcast: {},
            }),
          ),
        );
      }
      return true;
    },
    async control(step: string | null) {
      if (!step?.startsWith("event-window-")) return false;
      const op = step.slice("event-window-".length);
      if (op === "begin" || op === "flat") {
        active = true;
        collapsed = op === "begin";
        rows.clear();
        removedAt.clear();
        reads = 0;
        initialReads = 0;
        lastMode = undefined;
        seq = 0;
        frames.length = 0;
        resumed = 0;
        exactReads = 0;
        cancelled = false;
      } else if (op === "ready") {
        const until = Date.now() + 4000;
        while (!socket || reads === 0 || lastMode !== collapsed) {
          assert(
            Date.now() < until,
            "event window did not subscribe and read the empty channel",
          );
          await new Promise((r) => setTimeout(r, 8));
        }
        initialReads = reads;
      } else if (op === "first") {
        const post = row(one, "First event message");
        rows.set(one, post);
        awaiting = true;
        emit("posted", post);
      } else if (op === "during") {
        const until = Date.now() + 4000;
        while (!respond) {
          assert(Date.now() < until, "first event did not start HTTP");
          await new Promise((r) => setTimeout(r, 8));
        }
        const post = row(two, "Second event message");
        rows.set(two, post);
        emit("posted", post);
        respond();
        respond = undefined;
      } else if (op === "counts") {
        assert.equal(
          reads - initialReads,
          2,
          "the two groups around an in-flight HTTP read must both reach the server",
        );
      } else if (op === "paused") {
        await until(() => !socket, "The inactive window kept its WebSocket");
      } else if (op === "offline-edit" || op === "hidden-edit") {
        assert(!socket);
        const post = rows.get(one);
        assert(post);
        post.message = `First event message (${op})`;
        post.update_at++;
        post.edit_at = post.update_at;
        emit("post_edited", post);
      } else if (op === "resumed-edit") {
        await until(
          () => resumed > 0 && exactReads >= resumed,
          "A resumed connection did not reapply the edit by exact ID",
        );
      } else if (op === "history") {
        assert.equal(rows.size, 0);
        for (let n = 1; n <= 32; n++) {
          const id = `h${n.toString(36).padStart(25, "0")}`;
          const post = row(
            id,
            `History passage ${n}. ${"Older message. ".repeat(24)}`,
          );
          post.create_at = 100 + n;
          post.update_at = post.create_at;
          rows.set(id, post);
          if (n === 32) emit("posted", post);
        }
      } else if (op === "history-edit") {
        const post = rows.get(`h${(15).toString(36).padStart(25, "0")}`);
        assert(post);
        post.message = `Expanded older passage. ${"Remote edit. ".repeat(115)}`;
        post.update_at++;
        post.edit_at = post.update_at;
        emit("post_edited", post);
      } else if (op === "navigate-begin") {
        const post = row(
          "x".repeat(26),
          "There is a delayed post in Live room",
        );
        rows.set(post.id, post);
        awaiting = true;
        emit("posted", post);
        await until(
          () => Boolean(respond),
          "The original channel read never started",
        );
      } else if (op === "navigate-cancelled") {
        await until(
          () => cancelled,
          "Switching channel left the old request open",
        );
        respond = undefined;
      } else if (op === "reply") {
        const post = row(reply, "Live event reply", one);
        rows.set(reply, post);
        emit("posted", post);
      } else if (op === "edit") {
        const post = rows.get(reply);
        assert(post);
        post.message = "Edited event reply";
        post.update_at++;
        emit("post_edited", post);
      } else if (
        op === "delete-reply" ||
        op === "delete-root" ||
        op === "delete-second"
      ) {
        const id =
          op === "delete-reply" ? reply : op === "delete-root" ? one : two;
        const post = rows.get(id);
        assert(post);
        removedAt.set(id, post.create_at);
        rows.delete(id);
        if (op === "delete-root")
          for (const reply of rows.values()) {
            if (reply.root_id !== id) continue;
            removedAt.set(reply.id, reply.create_at);
            rows.delete(reply.id);
          }
        emit("post_deleted", post);
      } else if (op === "complete") {
        completed.push(collapsed ? "crt" : "flat");
        console.log("Open channel event fixture verified", completed.at(-1));
      } else if (op === "end") {
        if (completed.includes(collapsed ? "crt" : "flat"))
          await until(() => !socket, "Closing the App left its observer open");
        active = false;
        socket?.end();
        socket = undefined;
      } else throw Error(`Unknown event window step ${op}`);
      return true;
    },
    verify() {
      assert.deepEqual(completed, ["crt", "flat"]);
    },
    async handle(req: IncomingMessage, res: ServerResponse, url: URL) {
      if (!active || !url.pathname.startsWith(base)) return false;
      const path = url.pathname.slice(base.length);
      assert.equal(req.headers.authorization, "Bearer fixture-second-session");
      assert.equal(req.headers.cookie, undefined);
      function send(result: unknown) {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(result));
        return true;
      }
      const teamRoute = `users/me/teams/${team}`;
      if (path === "users/me/teams")
        return send([
          { id: team, name: "polar", display_name: "Polar", delete_at: 0 },
        ]);
      if (path === "users/me/teams/members")
        return send([
          { team_id: team, user_id: member, roles: "team_user", delete_at: 0 },
        ]);
      if (path === "users/me/preferences") return send([]);
      if (path === `${teamRoute}/channels`)
        return send(
          [
            [channel, "town-square", "Live room"],
            [otherChannel, "other-room", "Other room"],
          ].map(([id, name, display_name]) => ({
            id,
            team_id: team,
            name,
            display_name,
            type: "O",
            delete_at: 0,
          })),
        );
      if (path === `${teamRoute}/channels/members`)
        return send(
          [channel, otherChannel].map((channel_id) => ({
            channel_id,
            user_id: member,
            roles: "channel_user",
          })),
        );
      if (path === `${teamRoute}/channels/categories`)
        return send({
          order: ["k".repeat(26)],
          categories: [
            {
              id: "k".repeat(26),
              team_id: team,
              user_id: member,
              type: "channels",
              display_name: "Channels",
              channel_ids: [channel, otherChannel],
              sorting: "manual",
              sort_order: 0,
              collapsed: false,
              muted: false,
            },
          ],
        });
      if (path === "config/client")
        return send({
          CollapsedThreads: collapsed ? "always_on" : "disabled",
          TeammateNameDisplay: "username",
          WebsocketURL: "",
          WebsocketSecurePort: "443",
        });
      if (path === "license/client") return send({ IsLicensed: "false" });
      if (path === "users/me" || path === `users/${member}`)
        return send({ id: member, username: "reader", roles: "system_user" });
      if (path === "users/ids") {
        const ids = await readJson(req);
        assert(Array.isArray(ids));
        return send(
          ids.map((id) => ({
            id,
            username: id === member ? "reader" : "peer",
          })),
        );
      }
      if (path === "roles/names") {
        const names = await readJson(req);
        assert(Array.isArray(names));
        return send(
          names.map((name) => ({ name, permissions: ["create_post"] })),
        );
      }
      if (path === `channels/${otherChannel}/posts`) {
        const post = {
          ...row("y".repeat(26), "Independent channel position"),
          channel_id: otherChannel,
        };
        return send({
          ...list([]),
          order: [post.id],
          posts: { [post.id]: post },
        });
      }
      if (path === `channels/${channel}/posts`) {
        const q = url.searchParams;
        const requestedMode = q.get("collapsedThreads") === "true";
        let ids = [...rows.values()]
          .filter((post) => !requestedMode || !post.root_id)
          .reverse()
          .map((post) => post.id);
        const after = q.get("after"),
          before = q.get("before");
        const cursor = after ?? before;
        if (cursor) {
          const at = rows.get(cursor)?.create_at ?? removedAt.get(cursor);
          ids = ids.filter((id) => {
            const post = rows.get(id);
            assert(post);
            return (
              at !== undefined &&
              (after ? post.create_at > at : post.create_at < at)
            );
          });
        } else if (!q.has("since")) {
          reads++;
          lastMode = requestedMode;
          if (awaiting) {
            awaiting = false;
            const captured = list(ids);
            res.on("close", () => {
              if (!res.writableEnded) cancelled = true;
            });
            respond = () => {
              send(captured);
            };
            return true;
          }
        }
        return send(list(ids));
      }
      if (path === `posts/${one}/thread` && rows.has(one)) {
        const replies = [...rows.values()]
          .filter(
            (post) =>
              post.root_id === one &&
              post.id !== url.searchParams.get("fromPost"),
          )
          .map((post) => post.id);
        return send({ ...list([one, ...replies]), has_next: false });
      }
      const post = rows.get(path.slice("posts/".length));
      if (path.startsWith("posts/") && post) {
        if (post.id === one) exactReads++;
        return send(post);
      }
      res.writeHead(404, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "fixture.unknown",
          message: path,
          status_code: 404,
        }),
      );
      return true;
    },
  };
}
