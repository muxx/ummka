import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import https from "node:https";
import type { Socket } from "node:net";

export function webviewServers(
  trusted: https.ServerOptions,
  untrusted: https.ServerOptions,
) {
  const cases = ["headers", "body", "owner", "reload", "window"];
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
  const data = https.createServer(trusted, (req, res) => {
    const url = new URL(req.url ?? "/", "https://localhost");
    assert.equal(req.method, "GET");
    assert.equal(url.pathname, "/team/chat/api/v4/system/ping");
    const name = url.searchParams.get("check") ?? "";
    visits.push(name);
    const wait = held.get(name);
    if (wait) {
      req.socket.once("close", () => events.emit(`${name}-closed`));
      events.emit(`${name}-received`);
      if (name === "body")
        res.writeHead(200, { "Content-Length": "100" }).write("A");
      return;
    }
    if (name === "bytes") {
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
      ];
      if (platform === "macos") expected.push("window");
      assert.deepEqual(visits.sort(), expected.sort());
    },
  };
}
