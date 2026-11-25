import assert from "node:assert/strict";
import {
  Configuration,
  type Timezone,
  UsersApi,
} from "../../../vendor/mattermost/index.js";

export async function checkUserTimezone(base: string, token: string) {
  const users = new UsersApi(
    new Configuration({ basePath: base, accessToken: token }),
  );
  const read = async () => (await users.getUser({ userId: "me" })).timezone;
  const original = await read();
  assert.ok(original);
  assert.equal(typeof original.useAutomaticTimezone, "string");
  async function write(timezone: Timezone) {
    const result = await fetch(`${base}/api/v4/users/me/patch`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ timezone }),
    });
    assert.equal(result.status, 200);
  }
  try {
    for (const useAutomaticTimezone of ["false", "true"]) {
      const timezone = {
        useAutomaticTimezone,
        automaticTimezone: "Asia/Kathmandu",
        manualTimezone: "America/St_Johns",
      };
      await write(timezone);
      assert.deepEqual(await read(), timezone);
    }
  } finally {
    await write(original);
  }
}
