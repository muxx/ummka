import assert from "node:assert/strict";
import { loadWorkspaceServerPolicy } from "../../../src/mattermost/workspace-server.ts";
import { Configuration, PostsApi } from "../../../vendor/mattermost/index.js";

export async function checkReactionLimit(
  base: string,
  adminToken: string,
  adminId: string,
  memberToken: string,
  channelId: string,
) {
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
  const member = new Configuration({
    basePath: base,
    accessToken: memberToken,
  });
  const admin = new Configuration({ basePath: base, accessToken: adminToken });
  const initial = await loadWorkspaceServerPolicy(member);
  assert.equal(initial.uniqueReactionLimit, "50");
  const post = await new PostsApi(admin).createPost({
    createPostRequest: { channelId, message: "Server reaction limit fixture" },
  });
  assert.ok(post.id);
  async function setLimit(value: number) {
    const response = await fetch(`${base}/api/v4/config/patch`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        ServiceSettings: { UniqueEmojiReactionLimitPerPost: value },
      }),
    });
    assert.equal(response.status, 200);
  }
  try {
    for (const [configured, published, status] of [
      [-2, "-2", 400],
      [0, "0", 400],
      [1, "1", 200],
      [501, "500", 200],
    ] as const) {
      await setLimit(configured);
      assert.equal(
        (await loadWorkspaceServerPolicy(member)).uniqueReactionLimit,
        published,
      );
      const reaction: Response = await fetch(`${base}/api/v4/reactions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          user_id: adminId,
          post_id: post.id,
          emoji_name: configured === 501 ? "eyes" : "thumbsup",
        }),
      });
      assert.equal(reaction.status, status);
      const body = await reaction.json();
      if (status === 400)
        assert.equal(body.id, "app.reaction.save.save.too_many_reactions");
      else assert.equal(body.post_id, post.id);
    }
  } finally {
    await setLimit(Number(initial.uniqueReactionLimit));
  }
}
