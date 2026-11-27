import assert from "node:assert/strict";
import { readProfileImage } from "../../../src/mattermost/account-profile-image.ts";
import { channelProfile } from "../../../src/mattermost/channel-profiles.ts";
import {
  Configuration,
  ResponseError,
  UsersApi,
} from "../../../vendor/mattermost/index.js";

export async function checkProfileImage(
  viewer: Configuration,
  userId: string,
  ownerToken: string,
  adminToken: string,
  version: string,
) {
  const people = new UsersApi(viewer);
  async function profile() {
    const found = await people.getUser({ userId });
    assert.equal(found.id, userId);
    return channelProfile(found);
  }
  const initial = await profile();
  assert.equal(initial.lastPictureUpdate ?? 0, 0);
  const bytes = async (key: typeof initial) =>
    Buffer.from(await (await readProfileImage(viewer, key)).arrayBuffer());
  const original = await bytes(initial);
  const route = `${viewer.basePath}/api/v4/users/me/image`;
  const headers = { Authorization: `Bearer ${ownerToken}` };
  const form = new FormData();
  const fixture = await fetch("http://images.example.test:8099/sample.png");
  assert.equal(fixture.status, 200);
  form.append("image", await fixture.blob(), "sample.png");
  const upload = await fetch(route, { method: "POST", headers, body: form });
  assert.equal(upload.status, 200);
  try {
    const changed = await profile();
    assert.ok(changed.lastPictureUpdate && changed.lastPictureUpdate > 0);
    const custom = await bytes(changed);
    assert.notDeepEqual(custom, original);
    assert.equal(custom.readUInt32BE(16), 128);
    assert.equal(custom.readUInt32BE(20), 128);
    assert.deepEqual(await bytes(initial), custom);
    const publicApi = new Configuration({ basePath: viewer.basePath });
    await assert.rejects(
      readProfileImage(publicApi, changed),
      (e) => e instanceof ResponseError && e.response.status === 401,
    );
  } finally {
    const reset = await fetch(route, { method: "DELETE", headers });
    assert.equal(reset.status, 200);
  }
  const restored = await profile();
  assert.ok(restored.lastPictureUpdate && restored.lastPictureUpdate < 0);
  assert.equal(-restored.lastPictureUpdate, restored.updateAt);
  assert.deepEqual(await bytes(restored), original);
  // The viewing fixture has not joined a team or a shared conversation yet.
  const admin = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
  const role = await fetch(`${viewer.basePath}/api/v4/roles/name/system_user`, {
    headers: admin,
  });
  assert.equal(role.status, 200);
  const { id, permissions } = (await role.json()) as {
    id: string;
    permissions: string[];
  };
  assert.ok(permissions.includes("view_members"));
  async function setPermissions(next: string[]) {
    const result = await fetch(`${viewer.basePath}/api/v4/roles/${id}/patch`, {
      method: "PUT",
      headers: admin,
      body: JSON.stringify({ permissions: next }),
    });
    assert.equal(result.status, 200);
  }
  try {
    await setPermissions(permissions.filter((p) => p !== "view_members"));
    await assert.rejects(
      readProfileImage(viewer, restored),
      (e) => e instanceof ResponseError && e.response.status === 403,
    );
    const owner = new Configuration({
      basePath: viewer.basePath,
      accessToken: ownerToken,
    });
    assert.deepEqual(
      Buffer.from(
        await (await readProfileImage(owner, restored)).arrayBuffer(),
      ),
      original,
    );
  } finally {
    await setPermissions(permissions);
  }
  assert.deepEqual(await bytes(restored), original);
  console.log(
    `Mattermost ${version} verified a second ordinary member reads the changed and reset avatar with positive and negative revisions, including with the old cache key, and loses access after permission revocation.`,
  );
}
