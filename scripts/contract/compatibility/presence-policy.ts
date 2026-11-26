import assert from "node:assert/strict";
import { loadWorkspaceServerPolicy } from "../../../src/mattermost/workspace-server.ts";
import {
  Configuration,
  StatusApi,
  SystemApi,
} from "../../../vendor/mattermost/index.js";

export async function checkPresencePolicy(
  base: string,
  admin: string,
  member: string,
  memberId: string,
) {
  const signed = new Configuration({ basePath: base, accessToken: member });
  const system = new SystemApi(signed);
  const headers = {
    Authorization: `Bearer ${admin}`,
    "Content-Type": "application/json",
  };
  const full = await fetch(`${base}/api/v4/config`, { headers });
  assert.equal(full.status, 200);
  const original: unknown = (await full.json()).ServiceSettings
    .EnableUserStatuses;
  assert(typeof original === "boolean");
  async function configure(value: boolean) {
    const update = await fetch(`${base}/api/v4/config/patch`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ServiceSettings: { EnableUserStatuses: value } }),
    });
    assert.equal(update.status, 200);
    await update.body?.cancel();
  }
  try {
    for (const value of [false, true]) {
      await configure(value);
      const raw = await (
        await system.getClientConfigRaw({ format: "old" })
      ).raw.json();
      assert.equal(raw.EnableUserStatuses, String(value));
      if (!value) {
        const result = await new StatusApi(signed).getUsersStatusesByIdsRaw({
          requestBody: [memberId],
        });
        assert.equal(result.raw.status, 200);
        assert.deepEqual(await result.value(), []);
      }
      assert.equal(
        (await loadWorkspaceServerPolicy(signed)).userStatusesEnabled,
        value,
      );
    }
  } finally {
    await configure(original);
  }
}
