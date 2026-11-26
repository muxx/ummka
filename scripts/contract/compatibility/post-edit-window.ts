import assert from "node:assert/strict";
import { postEditWindow } from "../../../src/mattermost/workspace-preferences.ts";
import { loadWorkspaceServerPolicy } from "../../../src/mattermost/workspace-server.ts";
import { Configuration, SystemApi } from "../../../vendor/mattermost/index.js";

export async function checkPostEditWindow(
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
  async function published() {
    const config = await (await system.getClientConfigRaw(format)).raw.json();
    return config.PostEditTimeLimit;
  }
  async function setLimit(seconds: number) {
    const response = await fetch(`${base}/api/v4/config/patch`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ServiceSettings: { PostEditTimeLimit: seconds } }),
    });
    assert.equal(response.status, 200);
  }
  const original = await published();
  assert.equal(original, "-1");
  try {
    await setLimit(30);
    assert.equal(await published(), "30");
    const policy = await loadWorkspaceServerPolicy(member);
    assert.equal(policy.postEditLimitSeconds, "-1");
    assert.equal(postEditWindow(policy, 1000, 31000), "open");
  } finally {
    await setLimit(Number(original));
  }
}
