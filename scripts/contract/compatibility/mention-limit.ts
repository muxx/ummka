import assert from "node:assert/strict";
import type {
  ChannelsApi,
  PostsApi,
} from "../../../vendor/mattermost/index.js";

/** Exercise the actual notification gate, which differs from the sender's informational warning. */
export async function checkMentionLimit(
  base: string,
  adminToken: string,
  reader: ChannelsApi,
  posts: PostsApi,
  channelId: string,
  readerName: string,
) {
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
  const config = await fetch(`${base}/api/v4/config`, { headers });
  assert.equal(config.status, 200);
  const original = (await config.json()).TeamSettings
    .MaxNotificationsPerChannel;
  assert.ok(Number.isSafeInteger(original));
  const stats = await fetch(`${base}/api/v4/channels/${channelId}/stats`, {
    headers,
  });
  assert.equal(stats.status, 200);
  const members = (await stats.json()).member_count;
  assert.ok(Number.isSafeInteger(members) && members >= 2);
  const get = () => reader.getChannelMember({ channelId, userId: "me" });

  async function setLimit(limit: number) {
    const updated = await fetch(`${base}/api/v4/config/patch`, {
      headers,
      method: "PUT",
      body: JSON.stringify({
        TeamSettings: { MaxNotificationsPerChannel: limit },
      }),
    });
    assert.equal(updated.status, 200);
    assert.equal(
      (await updated.json()).TeamSettings.MaxNotificationsPerChannel,
      limit,
    );
  }
  try {
    for (const limit of [members + 1, members, members - 1]) {
      await setLimit(limit);
      const before = await get();
      await posts.createPost({
        createPostRequest: { channelId, message: "Boundary @all" },
      });
      await posts.createPost({
        createPostRequest: { channelId, message: `Control @${readerName}` },
      });
      const after = await get();
      assert.ok(typeof before.mentionCount === "number");
      assert.equal(
        after.mentionCount,
        before.mentionCount + (members < limit ? 2 : 1),
        `${members} members, limit ${limit}`,
      );
    }
  } finally {
    await setLimit(original);
  }
}
