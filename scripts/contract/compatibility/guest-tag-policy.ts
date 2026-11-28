import assert from "node:assert/strict";
import { loadWorkspaceServerPolicy } from "../../../src/mattermost/workspace-server.ts";
import { Configuration, SystemApi } from "../../../vendor/mattermost/index.js";

export async function checkGuestTagPolicy(
  base: string,
  adminToken: string,
  memberToken: string,
) {
  const member = new Configuration({
    basePath: base,
    accessToken: memberToken,
  });
  const system = new SystemApi(member);
  const format = { format: "old" };
  const license = await (await system.getClientLicenseRaw(format)).raw.json();
  assert.equal(license.IsLicensed, "false");
  async function readFlag() {
    const { raw } = await system.getClientConfigRaw(format);
    const config = await raw.json();
    return config.HideGuestTags;
  }
  async function setHidden(value: boolean) {
    const response = await fetch(`${base}/api/v4/config/patch`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ GuestAccountsSettings: { HideTags: value } }),
    });
    assert.equal(response.status, 200);
    await response.body?.cancel();
  }

  const original: unknown = await readFlag();
  assert(original === "false" || original === "true");
  try {
    for (const hidden of [false, true, false]) {
      await setHidden(hidden);
      assert.equal(await readFlag(), String(hidden));
      assert.equal(
        (await loadWorkspaceServerPolicy(member)).hideGuestTags,
        hidden,
      );
    }
  } finally {
    await setHidden(original === "true");
  }
}
