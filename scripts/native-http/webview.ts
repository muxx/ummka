import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import https from "node:https";
import type { Socket } from "node:net";
import { respondToAccount } from "./account.ts";
import { respondToHistory } from "./history.ts";
import { historyRefreshFixture } from "./history-refresh.ts";
import { respondToPostContext } from "./post-context.ts";

export function webviewServers(
  trusted: https.ServerOptions,
  untrusted: https.ServerOptions,
) {
  const cases = [
    "headers",
    "body",
    "owner",
    "reload",
    "window",
    "ping-headers",
    "ping-body",
    "batch-headers",
    "batch-body",
    "account-error-body",
    "account-retire",
    "refresh-late",
  ];
  const events = new EventEmitter();
  // Each fixture signal fires once and has no error event.
  const signal = (event: string) =>
    new Promise<void>((resolve) => events.once(event, resolve));
  const held = new Map(
    cases.map((name) => [
      name,
      {
        received: signal(`${name}-received`),
        closed: signal(`${name}-closed`),
      },
    ]),
  );
  const visits: string[] = [];
  let offlineHistoryRequests = 0;
  let connections = 0;
  let before = false;
  let disconnect: Socket | undefined;
  let pingSocket: Socket | undefined;
  const settings = new Map<string, ServerResponse>();
  const entrySettings = new Map<string, ServerResponse>();
  const userId = "Abc01234567890123456789012";
  const refresh = historyRefreshFixture(userId, () =>
    events.emit("refresh-late-received"),
  );
  const teamId = "Team0123456789012345678901";
  const channelId = "c".repeat(26);
  const teamReads = new Map<string, { name: string; body: object }>([
    [
      "/api/v4/users/me/teams",
      {
        name: "my-teams",
        body: [{ id: teamId, display_name: "Fixture Team" }],
      },
    ],
    [
      "/team/chat/api/v4/users/me/teams",
      {
        name: "directory-teams",
        body: [
          {
            id: teamId,
            name: "fixture",
            display_name: "Fixture Team",
            delete_at: 0,
          },
        ],
      },
    ],
    [
      "/team/chat/api/v4/users/me/teams/members",
      {
        name: "my-team-members",
        body: [
          {
            team_id: teamId,
            user_id: userId,
            roles: "team_guest",
            scheme_guest: true,
            scheme_user: false,
            scheme_admin: false,
            explicit_roles: "",
            delete_at: 0,
          },
        ],
      },
    ],
    [
      `/team/chat/api/v4/users/me/teams/${teamId}/channels?include_deleted=false&last_delete_at=123`,
      {
        name: "team-channels",
        body: [{ id: channelId, team_id: teamId, name: "town-square" }],
      },
    ],
    [
      `/team/chat/api/v4/users/${userId}/teams/${teamId}/channels/members`,
      {
        name: "team-memberships",
        body: [{ channel_id: channelId, user_id: userId }],
      },
    ],
    [
      `/team/chat/api/v4/users/me/teams/${teamId}/channels/categories`,
      {
        name: "sidebar-categories",
        body: {
          order: ["m".repeat(26)],
          categories: [
            {
              id: "m".repeat(26),
              user_id: userId,
              team_id: teamId,
              type: "managed",
              display_name: "Managed channels",
              channel_ids: [channelId],
              sorting: "manual",
              sort_order: 0,
              muted: false,
              collapsed: true,
            },
          ],
        },
      },
    ],
    [
      "/team/chat/api/v4/users/me/preferences",
      {
        name: "sidebar-preferences",
        body: [
          {
            user_id: userId,
            category: "direct_channel_show",
            name: "d".repeat(26),
            value: "false",
          },
        ],
      },
    ],
    [
      `/team/chat/api/v4/users/me/teams/${teamId}/channels?include_deleted=true`,
      {
        name: "directory-channels",
        body: [
          {
            id: channelId,
            type: "O",
            team_id: teamId,
            name: "town-square",
            display_name: "Town Square",
            delete_at: 0,
            last_root_post_at: 300,
          },
        ],
      },
    ],
    [
      `/team/chat/api/v4/users/me/teams/${teamId}/channels/members`,
      {
        name: "directory-channel-members",
        body: [
          { channel_id: channelId, user_id: userId, mention_count_root: 2 },
        ],
      },
    ],
  ]);
  function hold(name: string, req: IncomingMessage, res: ServerResponse) {
    req.socket.once("close", () => events.emit(`${name}-closed`));
    events.emit(`${name}-received`);
    if (name === "body" || name.endsWith("-body"))
      res.writeHead(200, { "Content-Length": "100" }).write("A");
  }
  const data = https.createServer(trusted, async (req, res) => {
    const url = new URL(req.url ?? "/", "https://localhost");
    if (url.pathname === "/team/chat/api/v4/users/usernames") {
      assert.equal(req.method, "POST");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers["content-type"], "application/json");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), [
        "unknown",
        "fixture",
      ]);
      visits.push("profiles-by-name");
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify([{ id: userId, username: "fixture" }]));
      return;
    }
    if (url.pathname === `/team/chat/api/v4/users/${userId}/image`) {
      assert.equal(req.method, "GET");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      visits.push("profile-image");
      res
        .writeHead(200, { "Content-Type": "image/png" })
        .end(
          readFileSync(
            new URL(
              "../../src-tauri/icons/linux/hicolor/48x48/apps/ummka.png",
              import.meta.url,
            ),
          ),
        );
      return;
    }
    if (refresh.handle(req, res, url)) return;
    if (url.pathname.startsWith("/offline-history/")) {
      offlineHistoryRequests++;
      res.writeHead(503, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          id: "fixture.unavailable",
          message: "Offline history fixture",
          status_code: 503,
        }),
      );
      return;
    }
    const account = respondToAccount(req, res, url, userId, (name) =>
      events.emit(name),
    );
    if (account) {
      visits.push(account);
      return;
    }
    const post = respondToPostContext(req, res, url, channelId, teamId);
    if (post) {
      visits.push(post);
      return;
    }
    const history = respondToHistory(req, res, url, channelId, userId);
    if (history) {
      visits.push(history);
      return;
    }
    if (
      url.pathname === "/team/chat/api/v4/users/ids" ||
      url.pathname === "/api/v4/users/ids"
    ) {
      const signed = url.pathname.startsWith("/team/chat/");
      const name = `batch-${req.headers["x-test-case"] ?? (signed ? "signed" : "anonymous")}`;
      visits.push(name);
      assert.equal(req.method, "POST");
      assert.equal(req.headers.cookie, undefined);
      assert.equal(
        req.headers.authorization,
        signed ? "Bearer fixture-prefixed-session" : undefined,
      );
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      if (name === "batch-text") {
        assert.equal(url.search, "");
        assert.equal(
          req.headers["content-type"],
          "application/json; charset=utf-8",
        );
        assert.deepEqual(
          Buffer.concat(chunks),
          Buffer.from('\ufeff ["Привет 👋"]\n'),
        );
        res.writeHead(204).end();
        return;
      }
      const ids = [userId, "b".repeat(26)];
      assert.equal(url.search, "?since=123");
      assert.equal(req.headers["content-type"], "application/json");
      assert.deepEqual(Buffer.concat(chunks), Buffer.from(JSON.stringify(ids)));
      if (held.has(name)) {
        hold(name, req, res);
        return;
      }
      res.writeHead(signed ? 200 : 401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          signed
            ? [
                { id: ids[1], first_name: "Юлия" },
                { id: userId, first_name: "Ada" },
              ]
            : { message: "session required" },
        ),
      );
      return;
    }
    assert.equal(req.method, "GET");
    const teamRead = teamReads.get(url.pathname + url.search);
    if (teamRead) {
      visits.push(teamRead.name);
      assert.equal(
        req.headers.authorization,
        url.pathname.startsWith("/team/chat/")
          ? "Bearer fixture-prefixed-session"
          : "Bearer fixture-root-session",
      );
      assert.equal(req.headers.cookie, undefined);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(teamRead.body));
      return;
    }
    if (url.pathname === "/api/v4/users/me") {
      visits.push("user-me");
      assert.equal(url.search, "");
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.cookie, undefined);
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "session required" }));
      return;
    }
    if (url.pathname === `/team/chat/api/v4/users/${userId}`) {
      visits.push("user-profile");
      assert.equal(url.search, "");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers.cookie, undefined);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ id: userId, username: "fixture", first_name: "Ada" }),
      );
      return;
    }
    const setting =
      /^\/(team\/chat|entry\/team)\/api\/v4\/(config|license)\/client$/.exec(
        url.pathname,
      );
    if (setting) {
      assert.equal(url.search, "?format=old");
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.cookie, undefined);
      const entry = setting[1] === "entry/team";
      const reports = entry ? entrySettings : settings;
      assert(!reports.has(setting[2]), "each profile operation is sent once");
      reports.set(setting[2], res);
      if (reports.size === 2) {
        for (const [name, response] of reports) {
          const body =
            name === "config"
              ? {
                  Version: "10.10.1",
                  SiteName: entry ? "Entry fixture" : "Fixture",
                  EnableSignInWithEmail: entry ? "true" : "false",
                  EnableSignUpWithGitLab: "true",
                }
              : { IsLicensed: "false" };
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify(body));
        }
      }
      return;
    }
    const rootPing = url.pathname === "/api/v4/system/ping";
    const generated = url.searchParams.has("use_rest_semantics");
    let name = url.searchParams.get("check") ?? "";
    if (generated) {
      assert.equal(url.search, "?use_rest_semantics=true");
      assert.equal(req.headers.cookie, undefined);
      assert.equal(req.headers.authorization, undefined);
      name = `ping-${req.headers["x-test-case"] ?? (rootPing ? "root" : "prefix")}`;
    }
    if (!(generated && rootPing))
      assert.equal(url.pathname, "/team/chat/api/v4/system/ping");
    visits.push(name);
    if (held.has(name)) {
      hold(name, req, res);
      return;
    }
    if (name === "ping-root" || name === "ping-prefix") {
      if (name === "ping-prefix") {
        if (pingSocket)
          assert.equal(
            req.socket,
            pingSocket,
            "sequential generated requests must reuse the connection",
          );
        pingSocket = req.socket;
      }
      res.setHeader("Set-Cookie", "previous=ignored; Path=/");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "OK" }));
    } else if (name === "ping-unhealthy" || name === "ping-error") {
      const failed = name === "ping-error";
      res.writeHead(failed ? 503 : 200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          failed ? { message: "unavailable" } : { status: "UNHEALTHY" },
        ),
      );
    } else if (name === "ping-redirect") {
      res
        .writeHead(302, {
          Location: "/team/chat/api/v4/system/ping?check=ping-destination",
        })
        .end();
    } else if (name === "bytes") {
      assert.equal(req.headers["x-fixture"], "café");
      res.setHeader("X-Fixture", "café");
      res.setHeader("Set-Cookie", "fixture=one; Path=/");
      res.setHeader("Set-Cookie2", "fixture=two");
      res.setHeader("ToKeN", ["fixture-secret-one", "fixture-secret-two"]);
      res.setHeader("Authorization", "Bearer fixture-secret");
      res.end(
        Buffer.from(Uint8Array.from({ length: 65_536 }, (_, i) => i % 251)),
      );
    } else if (name === "disconnect") {
      disconnect = req.socket;
      res.writeHead(200, { "Content-Length": "20" }).write("A");
    } else if (name === "redirect") {
      res
        .writeHead(302, {
          Location: "/team/chat/api/v4/system/ping?check=destination",
        })
        .end();
    } else if (["204", "205", "304", "401", "503"].includes(name)) {
      if (name === "401") {
        res.setHeader("ToKeN", "fixture-secret");
        res.setHeader("WWW-Authenticate", "Bearer");
      }
      res
        .writeHead(Number(name))
        .end(name === "401" || name === "503" ? "status body" : undefined);
    } else {
      res.writeHead(404).end();
    }
  });
  data.on("connection", () => {
    connections++;
  });
  const control = https.createServer(trusted, async (req, res) => {
    const url = new URL(req.url ?? "/", "https://localhost");
    assert.equal(url.pathname, "/api/v4/system/ping");
    const step = url.searchParams.get("step");
    if (step === "before") {
      assert.equal(
        connections,
        0,
        "prepared, cancelled and refused requests must not open a socket",
      );
      before = true;
    } else if (step === "release-history") {
      refresh.release();
    } else if (step === "disconnect") {
      assert(disconnect);
      disconnect.destroy();
    } else {
      const name = url.searchParams.get("case") ?? "";
      const wait = held.get(name);
      assert(wait);
      assert(step === "received" || step === "closed");
      await wait[step];
    }
    res.writeHead(204).end();
  });
  let untrustedRequests = 0;
  const foreign = https.createServer(untrusted, (_req, res) => {
    untrustedRequests++;
    res.end();
  });
  return {
    servers: [data, control, foreign],
    verify(platform: "macos" | "android") {
      refresh.verify();
      assert.equal(
        offlineHistoryRequests,
        1,
        "only the online control may reach the offline fixture",
      );
      assert(before);
      assert.equal(settings.size, 2);
      assert.equal(entrySettings.size, 2);
      assert.equal(untrustedRequests, 0);
      const expected = [
        "bytes",
        "204",
        "205",
        "304",
        "401",
        "503",
        "redirect",
        "disconnect",
        "headers",
        "body",
        "owner",
        "reload",
        "ping-root",
        "user-me",
        "user-profile",
        "profiles-by-name",
        "profile-image",
        "account-logout-confirmed",
        "account-logout-unconfirmed",
        "account-first",
        "account-second",
        "account-denied",
        "account-expired",
        "account-html",
        "account-large",
        "account-truncated",
        "account-error-body",
        "account-retire",
        "my-teams",
        "my-team-members",
        "directory-teams",
        "my-team-members",
        "sidebar-preferences",
        "team-channels",
        "directory-channels",
        "directory-channel-members",
        "directory-channels",
        "directory-channel-members",
        "sidebar-categories",
        "sidebar-categories",
        "team-memberships",
        "sidebar-categories",
        "sidebar-preferences",
        "history-root",
        "history-prefixed",
        "history-focused-after",
        "history-focused-before",
        "history-anonymous",
        "post-info-root",
        "post-info-prefixed",
        "post-thread-archive",
        "post-thread-reply",
        "batch-signed",
        "batch-anonymous",
        "batch-text",
        "batch-headers",
        "batch-body",
        "ping-prefix",
        "ping-prefix",
        "ping-unhealthy",
        "ping-error",
        "ping-redirect",
        "ping-headers",
        "ping-body",
      ];
      if (platform === "macos") expected.push("window");
      if (platform === "android") expected.push("account-logout-local-failure");
      expected.push(
        "directory-teams",
        "my-team-members",
        "sidebar-preferences",
      );
      if (platform === "android")
        expected.push(
          "browser-action-confirmed",
          "browser-action-confirmed",
          "browser-entry-unconfirmed",
          "browser-entry-unconfirmed",
          "browser-entry-config/client",
          "browser-entry-license/client",
          ...[
            "config/client",
            "license/client",
            "users/me/teams",
            "users/me/teams/members",
            "users/me/preferences",
          ].map((path) => "browser-entry-" + path),
        );
      assert.deepEqual(visits.sort(), expected.sort());
    },
  };
}
