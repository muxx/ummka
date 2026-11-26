import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import type { Server, Socket } from "node:net";
import { join } from "node:path";
import { authPrefix, checkAuthVisits, handleAuth } from "./authentication.ts";
import { eventFixture } from "./channel-events.ts";
import { mobileFilePolicyFixture } from "./mobile-file-policy.ts";
import { webviewServers } from "./webview.ts";

function certificates(dir: string) {
  const openssl = (...args: string[]) =>
    execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  const read = (name: string) => readFileSync(join(dir, name));
  writeFileSync(
    join(dir, "ca.cnf"),
    [
      "[req]",
      "distinguished_name=dn",
      "x509_extensions=ca",
      "[dn]",
      "[ca]",
      "basicConstraints=critical,CA:TRUE",
      "keyUsage=critical,keyCertSign,cRLSign",
    ].join("\n"),
  );
  for (const root of ["trusted", "foreign"]) {
    openssl(
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      `/CN=ummka ${root} test CA`,
      "-config",
      "ca.cnf",
      "-keyout",
      `${root}.key`,
      "-out",
      `${root}.pem`,
    );
  }
  openssl(
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=ummka fixture",
    "-keyout",
    "leaf.key",
    "-out",
    "leaf.csr",
  );
  const leaf = (name: string, issuer: string, san: string, serial: string) => {
    writeFileSync(
      join(dir, "leaf.cnf"),
      `basicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`,
    );
    openssl(
      "x509",
      "-req",
      "-in",
      "leaf.csr",
      "-days",
      "1",
      "-CA",
      `${issuer}.pem`,
      "-CAkey",
      `${issuer}.key`,
      "-set_serial",
      serial,
      "-extfile",
      "leaf.cnf",
      "-out",
      `${name}.crt`,
    );
    return { key: read("leaf.key"), cert: read(`${name}.crt`) };
  };
  return {
    trusted: leaf("valid", "trusted", "IP:127.0.0.1", "1"),
    untrusted: leaf("unknown", "foreign", "IP:127.0.0.1", "2"),
    wrongName: leaf("wrong", "trusted", "DNS:elsewhere.invalid", "3"),
    ca: read("trusted.pem"),
  };
}

// Only fixture-defined steps may appear in failure output.
const probeSteps = new Set([
  "login",
  "logout",
  "me",
  "received",
  "release",
  "detached-revoked",
  "event-handshake-arrived",
  "event-handshake-closed",
  "websocket",
  "scope-created",
  "scope-denied",
  "hold-headers",
  "headers-received",
  "headers-closed",
  "hold-body",
  "body-closed",
  "disconnect",
  "warm",
  "one",
  "two",
]);

export async function startFixture(dir: string) {
  let lastNativeProbe = "none";
  let probeCount = 0;
  function observe(kind: string, path?: string) {
    const step = path?.split("?", 1)[0].split("/").at(-1);
    lastNativeProbe = `${++probeCount} ${kind}${step && probeSteps.has(step) ? `/${step}` : ""}`;
  }
  const certs = certificates(dir);
  const visits: string[] = [];
  const authVisits: string[] = [];
  const pooled: Socket[] = [];
  const sockets = new Set<Socket>();
  const events = new EventEmitter();
  const logoutEvents = new EventEmitter();
  const logoutGates = new Map(
    ["out-dismiss", "out-race", "history-rejected", "history-old-out"].map(
      (name) =>
        [
          name,
          {
            received: once(logoutEvents, `${name}-received`),
            release: once(logoutEvents, `${name}-release`),
          },
        ] as const,
    ),
  );
  const beforeLogout = async (name: string) => {
    const gate = logoutGates.get(name);
    if (gate) {
      logoutEvents.emit(`${name}-received`);
      await gate.release;
    }
  };
  const detachedRevoked = once(events, "detached-revoked");
  const receivedHeaders = once(events, "received-headers");
  const closedHeaders = once(events, "closed-headers");
  const closedBody = once(events, "closed-body");
  const scopedConnections = [0, 0];
  const scopedSockets: Socket[] = [];
  const scopedRequests: {
    method?: string;
    path?: string;
    header?: string | string[];
    contentType?: string;
    body?: Buffer;
  }[] = [];
  let otherRequests = 0;
  const checkpoints: number[][] = [];
  const ok = (response: http.ServerResponse) => response.end("OK");
  const mobilePolicy = mobileFilePolicyFixture();
  const eventStream = eventFixture();
  const tls = https.createServer(certs.trusted, (request, response) => {
    const path = request.url;
    observe("https", path);
    if (eventStream.control(request, response)) return;
    if (mobilePolicy.handle(request, response)) return;
    const control = path?.match(
      /^\/auth-check\/([a-z-]+)\/(received|release)$/,
    );
    if (control) {
      const [, name, step] = control;
      const gate = logoutGates.get(name);
      assert(gate);
      if (step === "received") void gate.received.then(() => ok(response));
      else {
        logoutEvents.emit(`${name}-release`);
        ok(response);
      }
      return;
    }
    if (path === "/auth-check/detached-revoked") {
      void detachedRevoked.then(() => ok(response));
      return;
    }
    if (path?.startsWith(authPrefix)) {
      void handleAuth(request, response, authVisits, beforeLogout).then(
        (loggedOut) => {
          if (loggedOut === "detached") events.emit("detached-revoked");
        },
      );
      return;
    }
    assert(path);
    visits.push(path);
    if (path.startsWith("/team/chat/")) {
      assert.equal(
        visits.length + authVisits.length,
        pooled.length + 1,
        "measure reuse before other traffic reaches this origin",
      );
      pooled.push(request.socket);
      assert.equal(request.headers.cookie, undefined);
      if (path.endsWith("/one"))
        response.setHeader("Set-Cookie", "fixture=yes; Path=/");
      ok(response);
    } else if (path.startsWith("/redirect/")) {
      const [, , code, location] = path.split("/");
      if (location === "with") response.setHeader("Location", "/destination");
      response.writeHead(Number(code)).end();
    } else if (path.startsWith("/status/")) {
      response.setHeader("X-Fixture", "received");
      response.writeHead(Number(path.split("/")[2])).end("error body");
    } else if (path === "/hold-headers") {
      request.socket.once("close", () => events.emit("closed-headers"));
      events.emit("received-headers");
    } else if (path === "/headers-received") {
      void receivedHeaders.then(() => ok(response));
    } else if (path === "/headers-closed") {
      void closedHeaders.then(() => ok(response));
    } else if (path === "/hold-body") {
      request.socket.once("close", () => events.emit("closed-body"));
      response.writeHead(200, { "Content-Length": "100" }).write("first");
    } else if (path === "/body-closed") {
      void closedBody.then(() => ok(response));
    } else if (path === "/scope-created" || path === "/scope-denied") {
      checkpoints.push([
        scopedConnections[0],
        scopedRequests.length,
        scopedConnections[1],
        otherRequests,
      ]);
      ok(response);
    } else if (path === "/disconnect") {
      request.socket.destroy();
    } else {
      response.writeHead(404).end();
    }
  });
  tls.on("upgrade", (request, socket) => {
    observe("upgrade", request.url);
    eventStream.upgrade(request, socket);
  });
  let rejectedHttp = 0;
  const unexpected = (_req: http.IncomingMessage, res: http.ServerResponse) => {
    observe("unexpected-tls");
    rejectedHttp++;
    res.end();
  };
  const unknown = https.createServer(certs.untrusted, unexpected);
  const wrong = https.createServer(certs.wrongName, unexpected);
  const badTlsConnections = [0, 0];
  for (const [index, server] of [unknown, wrong].entries()) {
    server.on("connection", () => {
      badTlsConnections[index]++;
    });
  }
  let plainConnections = 0;
  const plain = http.createServer((_request, response) => {
    observe("cleartext");
    ok(response);
  });
  plain.on("connection", () => {
    plainConnections++;
  });

  let sessions = 0;
  const paths: string[] = [];
  const blocked: http2.Http2Stream[] = [];
  const h2 = http2.createSecureServer(certs.trusted);
  h2.on("session", () => {
    sessions++;
  });
  h2.on("stream", (stream, headers) => {
    const path = String(headers[":path"]);
    observe("http2", path);
    paths.push(path);
    if (path === "/warm") stream.end("OK");
    else {
      blocked.push(stream);
      if (blocked.length === 2)
        for (const pending of blocked) pending.end("OK");
    }
  });

  const selected = https.createServer(certs.trusted, async (req, res) => {
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    observe("account", req.url);
    scopedSockets.push(req.socket);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    scopedRequests.push({
      method: req.method,
      path: req.url,
      header: req.headers["x-fixture"],
      ...(chunks.length || req.method === "POST"
        ? {
            contentType: req.headers["content-type"],
            body: Buffer.concat(chunks),
          }
        : {}),
    });
    ok(res);
  });
  const other = https.createServer(certs.trusted, (_req, res) => {
    observe("other-origin");
    otherRequests++;
    ok(res);
  });
  for (const [i, server] of [selected, other].entries()) {
    server.on("connection", () => {
      scopedConnections[i]++;
    });
  }
  const native = [tls, unknown, wrong, h2, plain, selected, other];
  const webview = webviewServers(certs.trusted, certs.untrusted);
  const servers: Server[] = [...native, ...webview.servers];
  const close = () => {
    for (const server of servers) server.close();
    for (const socket of sockets) socket.destroy();
  };
  try {
    const ports = await Promise.all(
      servers.map(async (server) => {
        server.on("connection", (socket: Socket) => {
          sockets.add(socket);
          socket.on("close", () => sockets.delete(socket));
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        assert(address && typeof address !== "string");
        return address.port;
      }),
    );
    return {
      lastNativeProbe: () => lastNativeProbe,
      ports: ports.slice(0, native.length),
      webviewPorts: ports.slice(native.length),
      onAndroidInputReady: webview.onAndroidInputReady,
      ca: certs.ca,
      close,
      verify(android: boolean) {
        checkAuthVisits(authVisits);
        eventStream.verify();
        mobilePolicy.verify();
        webview.verify(android ? "android" : "macos");
        assert.deepEqual(checkpoints, [
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ]);
        assert.equal(scopedConnections[1], 0);
        assert.equal(otherRequests, 0);
        const ping = {
          method: "GET",
          path: "/Teams/Blue%20Sky//A%2FB/api/v4/system/ping?use_rest_semantics=true&device_id=wire%20check",
          header: "scoped",
        };
        const reads = [
          "channels/Channel0123456789012345678",
          "config/client?format=old",
          "license/client?format=old",
          "users/me",
          "users/me/image",
          "users/Abc01234567890123456789012",
          "users/me/teams",
          "users/me/teams/members",
          "users/Abc01234567890123456789012/teams/Team0123456789012345678901/channels?include_deleted=false",
          "users/me/teams/Team0123456789012345678901/channels/members",
          "users/me/teams/Team0123456789012345678901/channels/categories",
          "users/me/preferences",
          "channels/Channel0123456789012345678/posts?page=0&per_page=60&collapsedThreads=true",
          "channels/Channel0123456789012345678/pinned",
          "users/me/posts/flagged?page=1&per_page=60",
          "posts/Post0123456789012345678901/info",
          "posts/Post0123456789012345678901/thread?direction=down&perPage=1",
        ].map((route) => ({
          method: "GET",
          path: `/Teams/Blue%20Sky//A%2FB/api/v4/${route}`,
          header: undefined,
        }));
        const batch = {
          method: "POST",
          path: "/Teams/Blue%20Sky//A%2FB/api/v4/users/ids?since=123",
          header: undefined,
          contentType: "application/json",
          body: Buffer.from(
            '["Abc01234567890123456789012","def01234567890123456789012"]',
          ),
        };
        const prefix = "/Teams/Blue%20Sky//A%2FB/api/v4/";
        const pins = ["pin", "unpin"].map((action) => ({
          method: "POST",
          path: `${prefix}posts/Post0123456789012345678901/${action}`,
          header: undefined,
          contentType: undefined,
          body: Buffer.alloc(0),
        }));
        const settings = [
          ["PUT", "preferences"],
          ["POST", "preferences/delete"],
        ].map(([method, path]) => ({
          method,
          path: `${prefix}users/me/${path}`,
          header: undefined,
          contentType: "application/json",
          body: Buffer.from(
            '[{"user_id":"Abc01234567890123456789012","category":"flagged_post","name":"Post0123456789012345678901","value":"true"}]',
          ),
        }));
        assert.deepEqual(scopedRequests, [
          ping,
          ping,
          ...reads,
          batch,
          ...pins,
          ...settings,
        ]);
        assert.equal(
          scopedSockets[0],
          scopedSockets[1],
          "both scoped requests must reuse one HTTP/1.1 connection",
        );
        console.log(
          `Two scoped requests shared one connection. The selected origin accepted ${scopedConnections[0]} TCP connection(s).`,
        );
        assert.equal(rejectedHttp, 0);
        assert.deepEqual(badTlsConnections, [1, 1]);
        assert.equal(plainConnections, android ? 0 : 1);
        assert.equal(pooled.length, 2);
        assert(pooled[0] === pooled[1], "HTTP/1.1 must reuse the connection");
        assert.equal(sessions, 1);
        assert.deepEqual(paths.sort(), ["/one", "/two", "/warm"]);
        const redirects = [301, 302, 303, 307, 308].flatMap((code) =>
          ["with", "without"].map(
            (location) => `/redirect/${code}/${location}`,
          ),
        );
        assert.deepEqual(
          visits.sort(),
          [
            ...redirects,
            "/status/304",
            "/status/401",
            "/status/503",
            "/hold-headers",
            "/headers-received",
            "/headers-closed",
            "/hold-body",
            "/body-closed",
            "/disconnect",
            "/scope-created",
            "/scope-denied",
            "/team/chat/one",
            "/team/chat/two",
          ].sort(),
        );
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}
