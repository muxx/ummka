import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import https from "node:https";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startFixture } from "./fixture.ts";

function ping(agent: https.Agent, port: number, path: string) {
  return new Promise<{ connection?: string; socket: Socket }>(
    (resolve, reject) => {
      https
        .get({ agent, hostname: "127.0.0.1", port, path }, (response) => {
          const { connection } = response.headers;
          const { socket, statusCode } = response;
          response.once("error", reject);
          response.once("end", () => {
            if (statusCode !== 204 || !socket) {
              reject(new Error("Fixture ping did not return 204 over HTTPS"));
              return;
            }
            resolve({ connection, socket });
          });
          response.resume();
        })
        .once("error", reject);
    },
  );
}

test("WebView control receipts close their connections and data requests reuse theirs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ummka-control-receipts-"));
  try {
    const fixture = await startFixture(dir);
    const agent = new https.Agent({
      ca: fixture.ca,
      keepAlive: true,
      maxSockets: 1,
    });
    try {
      const [data, control] = fixture.webviewPorts;
      const controlPing = "/api/v4/system/ping?step=before";
      const first = await ping(agent, control, controlPing);
      const second = await ping(agent, control, controlPing);
      assert.equal(first.connection, "close");
      assert.equal(second.connection, "close");
      assert.notEqual(first.socket, second.socket);

      const dataPing = "/team/chat/api/v4/system/ping?check=204";
      const initialData = await ping(agent, data, dataPing);
      const nextData = await ping(agent, data, dataPing);
      assert.equal(initialData.socket, nextData.socket);
    } finally {
      agent.destroy();
      fixture.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
