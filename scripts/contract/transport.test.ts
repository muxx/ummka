import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
} from "node:http";
import { type TestContext, test } from "node:test";
import { createRestTransport } from "../../src/mattermost/rest-transport.ts";
import { createSystemApi } from "../../src/mattermost/system-api.ts";
import { ResponseError } from "../../vendor/mattermost/index.js";

async function listen(t: TestContext, handler?: RequestListener) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

test("canonicalizes the installation address and preserves its path and port", () => {
  for (const [input, expected] of [
    [
      "  HTTPS://Chat.Example.test:443/Teams/Blue%20Sky///  ",
      "https://chat.example.test/Teams/Blue%20Sky",
    ],
    ["http://[::1]:8065/a//b%2Fc/", "http://[::1]:8065/a//b%2Fc"],
    ["http://chat.example.test:80////", "http://chat.example.test"],
  ]) {
    assert.equal(createRestTransport(input, fetch).basePath, expected);
  }
});

test("rejects invalid installation addresses before dispatch with a safe error", () => {
  let sends = 0;
  const send: typeof fetch = async () => {
    sends++;
    return new Response();
  };
  for (const input of [
    "",
    "/chat",
    "chat.example.test",
    "ftp://chat.example.test",
    "https:///chat",
    "https://chat.example.test:65536",
    "https://name:example@chat.example.test/prefix",
    "https://chat.example.test/?parameter=value",
    "https://chat.example.test/?",
    "https://chat.example.test/#fragment",
    "https://chat.example.test/#",
    "https://chat.example.test/a\\b",
    "https://chat.example.test/a b",
    "https://chat.example.test/a\nb",
    "https://chat.example.test/a\u0000b",
    "https://chat.example.test/a%00b",
  ]) {
    assert.throws(() => createRestTransport(input, send), {
      name: "TypeError",
      message: "Invalid Mattermost server URL",
    });
  }
  assert.equal(sends, 0);
});

test("passes the generated request to the selected sender with explicit Fetch policies", async () => {
  const controller = new AbortController();
  const requests: Request[] = [];
  const send: typeof fetch = async (input, init) => {
    assert.equal(init?.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.signal, controller.signal);
    requests.push(new Request(input, init));
    return Response.json({ status: "OK" });
  };
  const transport = createRestTransport("http://127.0.0.1:1", send);
  const overrides: RequestInit = {
    credentials: "include",
    redirect: "follow",
    signal: controller.signal,
    headers: { "X-Test": "ping" },
  };
  const api = createSystemApi(transport.basePath, send);
  assert.equal(requests.length, 0);
  await api.getPing({ useRestSemantics: true }, overrides);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].headers.get("X-Test"), "ping");

  const post = new Request(transport.basePath, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "message",
  });
  await transport.fetchApi(post, { signal: controller.signal });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].method, "POST");
  assert.equal(requests[1].headers.get("Content-Type"), "text/plain");
  assert.equal(await requests[1].text(), "message");
});

test("GetPing sends the exact URL once and reads health independently of HTTP 200", async (t) => {
  let status = "OK";
  const received: IncomingMessage[] = [];
  const { base } = await listen(t, (req, res) => {
    received.push(req);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status, ActiveSearchBackend: "database" }));
  });
  const prefix = "/Teams/Blue%20Sky//A%2FB";
  for (const [input, expectedPrefix, health] of [
    ["", "", "OK"],
    ["/", "", "UNHEALTHY"],
    [prefix, prefix, "UNHEALTHY"],
    [`${prefix}///`, prefix, "OK"],
  ]) {
    status = health;
    const before = received.length;
    const result = await createSystemApi(base + input, fetch).getPing({
      useRestSemantics: true,
    });
    assert.equal(result.status, health);
    assert.equal(received.length, before + 1);
    const request = received[before];
    assert.equal(request.method, "GET");
    assert.equal(
      request.url,
      `${expectedPrefix}/api/v4/system/ping?use_rest_semantics=true`,
    );
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
  }
});

test("preserves the HTTP error status", async (t) => {
  const { base } = await listen(t, (_req, res) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end('{"message":"unavailable"}');
  });
  await assert.rejects(
    createSystemApi(base, fetch).getPing({ useRestSemantics: true }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "ResponseError" &&
      "response" in error &&
      error.response instanceof Response &&
      error.response.status === 503,
  );
});

test("stops at a redirect without contacting the destination", async (t) => {
  let destinationHits = 0;
  const destination = await listen(t, (_req, res) => {
    destinationHits++;
    res.end('{"status":"OK"}');
  });
  let redirects = 0;
  const { base } = await listen(t, (_req, res) => {
    redirects++;
    res.writeHead(302, { Location: `${destination.base}/target` }).end();
  });
  await assert.rejects(
    createSystemApi(base, fetch).getPing({ useRestSemantics: true }),
    {
      name: "FetchError",
    },
  );
  assert.equal(redirects, 1);
  assert.equal(destinationHits, 0);
});

test("aborting a pending GetPing closes the request on the server", {
  timeout: 10_000,
}, async (t) => {
  const { base, server } = await listen(t);
  const controller = new AbortController();
  const closedBeforeReply = new Promise<boolean>((resolve) => {
    server.once("request", (_req, res) => {
      res.once("close", () => resolve(!res.writableEnded));
      controller.abort();
    });
  });
  await assert.rejects(
    createSystemApi(base, fetch).getPing(
      { useRestSemantics: true },
      { signal: controller.signal },
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "FetchError" &&
      error.cause instanceof Error &&
      error.cause.name === "AbortError",
  );
  assert.equal(await closedBeforeReply, true);
});

test("reports a disconnected socket as a transport error", async (t) => {
  const { base } = await listen(t, (_req, res) => res.destroy());
  await assert.rejects(
    createSystemApi(base, fetch).getPing({ useRestSemantics: true }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "FetchError" &&
      error.cause instanceof Error &&
      !("response" in error),
  );
});

test("generated raw methods read public settings under each installation prefix", async (t) => {
  const received: IncomingMessage[] = [];
  const config = { Version: "10.10.1", EnableSignUpWithGitLab: "true" };
  const license = { IsLicensed: "false" };
  const { base } = await listen(t, (req, res) => {
    received.push(req);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(req.url?.includes("/config/client?") ? config : license),
    );
  });
  for (const prefix of ["", "/team/chat"]) {
    const api = createSystemApi(base + prefix, fetch);
    const before = received.length;
    assert.deepEqual(
      await (await api.getClientConfigRaw({ format: "old" })).raw.json(),
      config,
    );
    assert.deepEqual(
      await (await api.getClientLicenseRaw({ format: "old" })).raw.json(),
      license,
    );
    const requests = received.slice(before);
    assert.deepEqual(
      requests.map((req) => req.url),
      [
        `${prefix}/api/v4/config/client?format=old`,
        `${prefix}/api/v4/license/client?format=old`,
      ],
    );
    for (const req of requests) {
      assert.equal(req.method, "GET");
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.cookie, undefined);
    }
  }
});

test("both settings operations retain an HTTP error body", async (t) => {
  const { base } = await listen(t, (_req, res) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end('{"message":"offline"}');
  });
  const api = createSystemApi(base, fetch);
  for (const request of [
    () => api.getClientConfigRaw({ format: "old" }),
    () => api.getClientLicenseRaw({ format: "old" }),
  ]) {
    const error: unknown = await request().catch((reason: unknown) => reason);
    assert(error instanceof ResponseError);
    assert.equal(error.response.status, 503);
    assert.deepEqual(await error.response.json(), { message: "offline" });
  }
});
