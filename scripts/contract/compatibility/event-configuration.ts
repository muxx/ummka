import assert from "node:assert/strict";
import { loadWorkspaceConfiguration } from "../../../src/mattermost/workspace-server.ts";
import { Configuration } from "../../../vendor/mattermost/index.js";

export async function checkEventConfiguration(
  base: string,
  adminToken: string,
  memberToken: string,
  version: string,
) {
  const member = new Configuration({
    basePath: base,
    accessToken: memberToken,
  });
  const { eventAddress, server } = await loadWorkspaceConfiguration(member);
  assert.deepEqual(eventAddress, { url: "", securePort: "443" });
  async function update(url: string, port: number) {
    const reply = await fetch(base + "/api/v4/config/patch", {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + adminToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ServiceSettings: { WebsocketURL: url, WebsocketSecurePort: port },
      }),
    });
    assert.equal(reply.status, 200);
    await reply.arrayBuffer();
  }
  const explicit = "wss://events.example.test/installation";
  try {
    await update(explicit, 8443);
    const fresh = await loadWorkspaceConfiguration(member);
    assert.deepEqual(fresh.eventAddress, { url: explicit, securePort: "8443" });
    assert.deepEqual(fresh.server, server);
  } finally {
    await update("", 443);
  }
  console.log(
    `Mattermost ${version} verified signed event configuration before and after the address changed.`,
  );
}
