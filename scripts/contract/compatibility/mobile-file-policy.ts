import assert from "node:assert/strict";
import { Configuration, SystemApi } from "../../../vendor/mattermost/index.js";

/** The administrator controls this disposable server. The normal member only reads public client settings. */
export async function checkMobileFilePolicy(
  base: string,
  admin: string,
  member: string,
) {
  const client = new SystemApi(
    new Configuration({ basePath: base, accessToken: member }),
  );
  const options = { format: "old" };
  const license = await (await client.getClientLicenseRaw(options)).raw.json();
  assert.equal(license.IsLicensed, "false");
  const headers = {
    Authorization: `Bearer ${admin}`,
    "Content-Type": "application/json",
  };
  async function effective() {
    const response = await fetch(`${base}/api/v4/config`, { headers });
    assert.equal(response.status, 200);
    const value: unknown = (await response.json()).FileSettings
      .EnableMobileDownload;
    assert(typeof value === "boolean");
    return value;
  }
  async function configure(value: boolean) {
    const response = await fetch(`${base}/api/v4/config/patch`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ FileSettings: { EnableMobileDownload: value } }),
    });
    assert.equal(response.status, 200);
    assert.equal(
      await effective(),
      value,
      "fixture configuration did not change",
    );
  }
  const original = await effective();
  try {
    for (const value of [true, false]) {
      await configure(value);
      const config = await (
        await client.getClientConfigRaw(options)
      ).raw.json();
      assert.equal(config.EnableMobileFileDownload, "true");
    }
  } finally {
    await configure(original);
  }
  console.log(
    "Team Edition published mobile file downloads as enabled for a signed participant with both administrative FileSettings values.",
  );
}
