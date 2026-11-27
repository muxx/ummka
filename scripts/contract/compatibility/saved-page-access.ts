import assert from "node:assert/strict";
import { openPostCollection } from "../../../src/channels/post-collection.ts";
import { accountPostCollections } from "../../../src/mattermost/account-post-collections.ts";
import { accountCollectionActions } from "../../../src/mattermost/post-collection-actions.ts";
import {
  Configuration,
  PostsApi,
  PreferencesApi,
} from "../../../vendor/mattermost/index.js";

export async function checkSparseSavedPages(
  origin: string,
  adminToken: string,
  member: { token: string; id: string },
  authorToken: string,
  teamId: string,
  visible: string,
  hidden: string,
  version: string,
) {
  const config = new Configuration({
    basePath: origin,
    accessToken: member.token,
  });
  const author = new PostsApi(
    new Configuration({ basePath: origin, accessToken: authorToken }),
  );
  const account = {
    ...accountPostCollections(config, member.id, (read) => read()),
    ...accountCollectionActions(config, member.id, (write) => write()),
  };
  const scope = { kind: "team" as const, teamId };
  const ids: string[] = [];
  const times: number[] = [];
  const root = await author.createPost({
    createPostRequest: { channelId: visible, message: "Saved replies fixture" },
  });
  assert.ok(root.id);
  for (let n = 0; n < 121; n++) {
    const channelId = n > 0 && n <= 60 ? hidden : visible;
    const row = await author.createPost({
      createPostRequest: {
        channelId,
        message: `Saved access fixture ${n}`,
        ...((n === 0 || n === 61) && { rootId: root.id }),
      },
    });
    assert.ok(row.id && row.createAt);
    ids.push(row.id);
    times.push(row.createAt);
  }
  assert.ok(times[0] < times[1] && times[60] < times[61]);
  const preferences = new PreferencesApi(config);
  const otherValues = new Map([
    [ids[0], "false"],
    [ids[61], ""],
  ]);
  for (const batch of [ids.slice(0, 100), ids.slice(100)])
    await preferences.updatePreferences({
      userId: "me",
      preference: batch.map((name) => ({
        userId: member.id,
        category: "flagged_post",
        name,
        value: otherValues.get(name) ?? "true",
      })),
    });
  const adminHeaders = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
  const role = await fetch(`${origin}/api/v4/roles/name/channel_user`, {
    headers: adminHeaders,
  });
  assert.equal(role.status, 200);
  const { id, permissions } = (await role.json()) as {
    id: string;
    permissions: string[];
  };
  assert.ok(permissions.includes("read_channel_content"));
  const change = async (values: string[]) => {
    const changed = await fetch(`${origin}/api/v4/roles/${id}/patch`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ permissions: values }),
    });
    assert.equal(changed.status, 200);
  };
  // The SQL input contains the still-joined private channel. The ordinary member
  // retains public-channel access through the team, while private rows are filtered.
  const view = openPostCollection(account, scope);
  try {
    await change(permissions.filter((p) => p !== "read_channel_content"));
    assert.deepEqual(await account.readSavedPostPreferences(), {
      ids: new Set(ids),
      upperBound: ids.length,
    });
    assert.deepEqual((await account.readSavedPosts(scope, 1)).items, []);
    assert.deepEqual(
      (await account.readSavedPosts(scope, 2)).items.map((row) => row.id),
      [ids[0]],
    );
    await view.refresh();
    const first = view.getSnapshot().value?.items;
    assert.ok(first && first.length === 60);
    assert.equal(view.getSnapshot().continuation, "available");
    assert.deepEqual(
      new Set(first.map((row) => row.id)),
      new Set(ids.slice(61)),
    );
    await view.loadMore();
    assert.equal(view.getSnapshot().value?.items.length, 60);
    assert.equal(view.getSnapshot().continuation, "available");
    await view.loadMore();
    assert.deepEqual(
      new Set(view.getSnapshot().value?.items.map((row) => row.id)),
      new Set([ids[0], ...ids.slice(61)]),
    );
    assert.equal(view.getSnapshot().continuation, "none");
  } finally {
    view.close();
    await change(permissions);
  }
  console.log(
    `Mattermost ${version} verified saved keys for distinct replies in one thread, including false and empty values, and continuation past a hidden 60-row page.`,
  );
}
