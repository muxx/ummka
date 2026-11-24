import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import type { Server, Socket } from "node:net";
import { join } from "node:path";
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

export async function startFixture(dir: string) {
  const certs = certificates(dir);
  const visits: string[] = [];
  const pooled: Socket[] = [];
  const sockets = new Set<Socket>();
  const events = new EventEmitter();
  const receivedHeaders = once(events, "received-headers");
  const closedHeaders = once(events, "closed-headers");
  const closedBody = once(events, "closed-body");
  const scopedConnections = [0, 0];
  const scopedSockets: Socket[] = [];
  const scopedRequests: {
    method?: string;
    path?: string;
    header?: string | string[];
  }[] = [];
  let otherRequests = 0;
  const checkpoints: number[][] = [];
  const ok = (response: http.ServerResponse) => response.end("OK");
  const tls = https.createServer(certs.trusted, (request, response) => {
    const path = request.url;
    assert(path);
    visits.push(path);
    if (path.startsWith("/team/chat/")) {
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
  let rejectedHttp = 0;
  const unexpected = (_req: http.IncomingMessage, res: http.ServerResponse) => {
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
  const plain = http.createServer((_request, response) => ok(response));
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
    paths.push(path);
    if (path === "/warm") stream.end("OK");
    else {
      blocked.push(stream);
      if (blocked.length === 2)
        for (const pending of blocked) pending.end("OK");
    }
  });

  const selected = https.createServer(certs.trusted, (req, res) => {
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    scopedSockets.push(req.socket);
    scopedRequests.push({
      method: req.method,
      path: req.url,
      header: req.headers["x-fixture"],
    });
    ok(res);
  });
  const other = https.createServer(certs.trusted, (_req, res) => {
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
      ports: ports.slice(0, native.length),
      webviewPorts: ports.slice(native.length),
      ca: certs.ca,
      close,
      verify(android: boolean) {
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
          "config/client?format=old",
          "license/client?format=old",
          "users/me",
          "users/Abc01234567890123456789012",
          "users/me/teams",
          "users/Abc01234567890123456789012/teams/Team0123456789012345678901/channels?include_deleted=false",
          "users/me/teams/Team0123456789012345678901/channels/members",
        ].map((route) => ({
          method: "GET",
          path: `/Teams/Blue%20Sky//A%2FB/api/v4/${route}`,
          header: undefined,
        }));
        assert.deepEqual(scopedRequests, [ping, ping, ...reads]);
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
        assert.equal(
          pooled[0],
          pooled[1],
          "HTTP/1.1 must reuse the connection",
        );
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
