import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { json } from "node:stream/consumers";
import { respondToAccount } from "./account.ts";
import { respondToWorkspace } from "./workspace.ts";

export function recipientWindowFixture() {
  const own = "f".repeat(26),
    team = "Team0123456789012345678901";
  const peer = "p".repeat(26),
    second = "q".repeat(26),
    direct = "s".repeat(26);
  const people = [
    { id: own, username: "fixture-author", delete_at: 0 },
    { id: peer, username: "north", delete_at: 0 },
    { id: second, username: "south", delete_at: 0 },
  ];
  const visibility: { selfOpenedAt?: string } = {};
  const prefix = "/recipient-window/api/v4/";
  const browserToken = "fixture-recipient-window";
  const visits: string[] = [];
  let created = false;
  let refreshFailed = false;
  return {
    async serve(req: IncomingMessage, res: ServerResponse, url: URL) {
      if (!url.pathname.startsWith(prefix)) return false;
      const path = url.pathname.slice(prefix.length);
      const send = (body: unknown, status = 200) => {
        assert.equal(req.headers.authorization, `Bearer ${browserToken}`);
        assert.equal(req.headers.cookie, undefined);
        res
          .writeHead(status, { "Content-Type": "application/json" })
          .end(JSON.stringify(body));
        visits.push(path);
        return true;
      };
      if (path === "users") {
        assert.equal(req.method, "GET");
        assert.deepEqual(Object.fromEntries(url.searchParams), {
          in_team: team,
          active: "true",
          page: "0",
          per_page: "100",
        });
        return send(people);
      }
      if (path === "users/search") {
        assert.equal(req.method, "POST");
        assert.deepEqual(await json(req), {
          term: "south",
          team_id: team,
          allow_inactive: false,
          limit: 100,
        });
        return send([people[2]]);
      }
      if (path === "channels/group") {
        assert.equal(req.method, "POST");
        assert.deepEqual(await json(req), [own, peer, second]);
        return send(
          {
            id: "api.context.permissions.app_error",
            message: "Group conversations are restricted.",
            status_code: 403,
          },
          403,
        );
      }
      if (path === "channels/direct") {
        assert.equal(req.method, "POST");
        assert.equal(created, false, "Recipient picker posted twice");
        assert.deepEqual(await json(req), [own, own]);
        created = true;
        return send(
          {
            id: direct,
            team_id: "",
            type: "D",
            name: `${own}__${own}`,
            delete_at: 0,
          },
          201,
        );
      }
      if (
        created &&
        !refreshFailed &&
        path === `users/me/teams/${team}/channels`
      ) {
        assert.equal(req.method, "GET");
        refreshFailed = true;
        return send(
          { id: "fixture.sidebar.unavailable", status_code: 503 },
          503,
        );
      }
      const common = new URL(url);
      common.pathname = `/browser-action-check/api/v4/${path}`;
      const label =
        (await respondToWorkspace(req, res, common, own, false, {
          visible: created ? visibility : undefined,
          browserToken,
        })) ??
        respondToAccount(req, res, common, own, () => {}, { browserToken });
      assert.ok(label, `Unexpected recipient picker path ${path}`);
      visits.push(label);
      return true;
    },
    verify() {
      assert.equal(
        visits.filter((path) => path === "channels/group").length,
        1,
      );
      assert.equal(
        visits.filter((path) => path === "channels/direct").length,
        1,
      );
      assert.equal(visits.filter((path) => path === "users/search").length, 1);
      assert.ok(
        refreshFailed,
        "Recipient picker did not retry reading the sidebar",
      );
      assert.ok(
        visibility.selfOpenedAt,
        "The ordinary navigation did not reopen the personal conversation",
      );
      assert.ok(visits.includes(`live-posts-${direct}`));
    },
  };
}
