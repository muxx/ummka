import assert from "node:assert/strict";
import { channelProfile } from "../../../src/mattermost/channel-profiles.ts";
import { readConversationRecipient } from "../../../src/mattermost/link-recipient.ts";
import {
  Configuration,
  ResponseError,
  UsersApi,
} from "../../../vendor/mattermost/index.js";

export async function checkExactProfileReads(
  basePath: string,
  adminToken: string,
  memberToken: string,
  person: { id: string; username: string; email: string },
  version: string,
) {
  assert.equal(person.email, "history+lookup?#%42@example.test");
  const users = new UsersApi(
    new Configuration({ basePath, accessToken: memberToken }),
  );
  const anonymous = new UsersApi(new Configuration({ basePath }));
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
  const config = await fetch(`${basePath}/api/v4/config`, { headers });
  assert.equal(config.status, 200);
  const original = (await config.json()).PrivacySettings.ShowEmailAddress;
  assert.equal(typeof original, "boolean");
  async function showEmail(value: boolean) {
    const response = await fetch(`${basePath}/api/v4/config/patch`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ PrivacySettings: { ShowEmailAddress: value } }),
    });
    assert.equal(response.status, 200);
  }
  const status = (expected: number) => (error: unknown) =>
    error instanceof ResponseError && error.response.status === expected;
  try {
    await showEmail(true);
    const confirmed = channelProfile(
      await users.getUser({ userId: person.id }),
    );
    const empty = async () => ({ usernames: {}, profiles: {} });
    const saved = async () => ({
      usernames: { [person.username]: person.id },
      profiles: { [person.id]: confirmed },
    });
    const byName = { kind: "username", name: person.username } as const;
    const byEmail = { kind: "email", email: person.email } as const;
    for (const [target, directory] of [
      [{ kind: "user-id", id: person.id }, empty],
      [byName, empty],
      [byName, saved],
      [byEmail, empty],
    ] as const) {
      assert.deepEqual(
        await readConversationRecipient(users, target, directory),
        confirmed,
      );
    }
    assert.equal(
      await readConversationRecipient(
        users,
        { kind: "username", name: "fixture:remote" },
        empty,
      ),
      null,
    );
    assert.equal(
      (await users.getUserByUsername({ username: person.username })).id,
      person.id,
    );
    assert.equal(
      (await users.getUserByEmail({ email: person.email })).id,
      person.id,
    );
    await assert.rejects(
      users.getUserByUsername({ username: "absent-exact-profile" }),
      status(404),
    );
    await assert.rejects(
      users.getUserByEmail({ email: "absent-exact@example.test" }),
      status(404),
    );
    await assert.rejects(
      users.getUserByUsername({ username: "fixture:remote" }),
      status(404),
    );
    await assert.rejects(
      anonymous.getUserByUsername({ username: person.username }),
      status(401),
    );
    await assert.rejects(
      anonymous.getUserByEmail({ email: person.email }),
      status(401),
    );
    await showEmail(false);
    assert.equal(await readConversationRecipient(users, byEmail, empty), null);
    assert.deepEqual(
      await readConversationRecipient(users, byName, empty),
      confirmed,
    );
    await assert.rejects(
      users.getUserByEmail({ email: person.email }),
      status(403),
    );
    await assert.rejects(
      users.getUserByEmail({ email: "absent-exact@example.test" }),
      status(403),
    );
    const stillVisible = await users.getUserByUsername({
      username: person.username,
    });
    assert.equal(stillVisible.id, person.id);
    assert.ok(!stillVisible.email);
  } finally {
    await showEmail(original);
  }
  console.log(
    `Mattermost ${version} verified exact username and an email containing +?# and literal %42, hidden email, missing profiles and unsigned access.`,
  );
  console.log(
    `Mattermost ${version} verified the signed recipient by ID, known and unknown names, and email.`,
  );
}
