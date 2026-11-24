import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import https from "node:https";
import type { Socket } from "node:net";
import { respondToHistory } from "./history.ts";

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
  ];
  const events = new EventEmitter();
  const held = new Map(
    cases.map((name) => [
      name,
      {
        received: once(events, `${name}-received`),
        closed: once(events, `${name}-closed`),
      },
    ]),
  );
  const visits: string[] = [];
  let connections = 0;
  let before = false;
  let disconnect: Socket | undefined;
  let pingSocket: Socket | undefined;
  const settings = new Map<string, ServerResponse>();
  const userId = "Abc01234567890123456789012";
  const teamId = "Team0123456789012345678901";
  const channelId = "c".repeat(26);
  const teamReads = new Map<
    string,
    { name: string; query: string; body: object[] }
  >([
    [
      "/api/v4/users/me/teams",
      {
        name: "my-teams",
        query: "",
        body: [{ id: teamId, display_name: "Fixture Team" }],
      },
    ],
    [
      `/team/chat/api/v4/users/me/teams/${teamId}/channels`,
      {
        name: "team-channels",
        query: "?include_deleted=false&last_delete_at=123",
        body: [{ id: channelId, team_id: teamId, name: "town-square" }],
      },
    ],
    [
      `/team/chat/api/v4/users/${userId}/teams/${teamId}/channels/members`,
      {
        name: "team-memberships",
        query: "",
        body: [{ channel_id: channelId, user_id: userId }],
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
        signed ? "Bearer synthetic-session" : undefined,
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
    const teamRead = teamReads.get(url.pathname);
    if (teamRead) {
      visits.push(teamRead.name);
      assert.equal(url.search, teamRead.query);
      assert.equal(req.headers.authorization, "Bearer synthetic-session");
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
      assert.equal(req.headers.authorization, "Bearer synthetic-session");
      assert.equal(req.headers.cookie, undefined);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ id: userId, username: "fixture", first_name: "Ada" }),
      );
      return;
    }
    const setting = /^\/team\/chat\/api\/v4\/(config|license)\/client$/.exec(
      url.pathname,
    )?.[1];
    if (setting) {
      assert.equal(url.search, "?format=old");
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.cookie, undefined);
      assert(!settings.has(setting), "each profile operation is sent once");
      settings.set(setting, res);
      if (settings.size === 2) {
        for (const [name, response] of settings) {
          const body =
            name === "config"
              ? {
                  Version: "10.10.1",
                  SiteName: "Fixture",
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
      assert(before);
      assert.equal(settings.size, 2);
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
        "my-teams",
        "team-channels",
        "team-memberships",
        "history-root",
        "history-prefixed",
        "history-anonymous",
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
      assert.deepEqual(visits.sort(), expected.sort());
    },
  };
}
