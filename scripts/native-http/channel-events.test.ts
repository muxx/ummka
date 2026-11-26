import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { eventFixture } from "./channel-events.ts";

test("the denied WebSocket response retires its HTTP/1.1 connection", async (t) => {
  const fixture = eventFixture();
  const server = createServer();
  server.on("upgrade", (req, socket) => fixture.upgrade(req, socket));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const response = await new Promise<import("node:http").IncomingMessage>(
    (resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: (server.address() as AddressInfo).port,
          path: "/Event%20Site//denied/api/v4/websocket?connection_id=&sequence_number=0",
          headers: {
            Authorization: "Bearer event-fixture-token",
            Connection: "Upgrade",
            Upgrade: "websocket",
          },
        },
        resolve,
      );
      req.once("error", reject).end();
    },
  );
  response.resume();
  assert.equal(response.statusCode, 403);
  assert.equal(response.headers.connection, "close");
});
