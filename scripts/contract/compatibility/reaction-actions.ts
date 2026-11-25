import assert from "node:assert/strict";
import {
  postReactionBadges,
  postReactionDecision,
} from "../../../src/channels/post-reaction-actions.ts";
import {
  Configuration,
  PostsApi,
  ReactionsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkReactionActions(
  base: string,
  admin: { id: string; token: string },
  member: { id: string; token: string },
  dmId: string,
) {
  const session = new Configuration({
    basePath: base,
    accessToken: admin.token,
  });
  const adminApi = new ReactionsApi(session);
  const memberApi = new ReactionsApi(
    new Configuration({ basePath: base, accessToken: member.token }),
  );
  const post = await new PostsApi(session).createPost({
    createPostRequest: { channelId: dmId, message: "Reaction limit fixture" },
  });
  assert.ok(post.id);
  const postId = post.id;
  async function limit() {
    const response = await fetch(`${base}/api/v4/config/client?format=old`, {
      headers: { Authorization: `Bearer ${member.token}` },
    });
    assert.equal(response.status, 200);
    const value = (await response.json()).UniqueEmojiReactionLimitPerPost;
    assert.match(value, /^\d+$/);
    return Number(value);
  }
  const previous = await limit();
  async function setLimit(value: number) {
    const response = await fetch(`${base}/api/v4/config/patch`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${admin.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ServiceSettings: { UniqueEmojiReactionLimitPerPost: value },
      }),
    });
    assert.equal(response.status, 200);
  }
  await setLimit(1);
  try {
    const access = {
      online: true,
      archived: false,
      add: "allowed",
      remove: "allowed",
      uniqueLimit: await limit(),
    } as const;
    assert.equal(access.uniqueLimit, 1);
    await adminApi.saveReaction({
      saveReactionRequest: { postId, userId: admin.id, emojiName: "thumbsup" },
    });
    const before = postReactionBadges(
      postId,
      member.id,
      (await memberApi.getReactions({ postId })) ?? [],
    );
    assert.equal(
      postReactionDecision(before, "thumbsup", "toggle", access),
      "add",
    );
    assert.equal(
      postReactionDecision(before, "+1", "add", access),
      "limitReached",
    );
    await memberApi.saveReaction({
      saveReactionRequest: { postId, userId: member.id, emojiName: "thumbsup" },
    });
    try {
      await memberApi.saveReaction({
        saveReactionRequest: { postId, userId: member.id, emojiName: "+1" },
      });
      assert.fail("The configured server limit must reject a new emoji name");
    } catch (error) {
      assert.ok(error instanceof ResponseError);
      assert.equal(error.response.status, 400);
      assert.equal(
        (await error.response.json()).id,
        "app.reaction.save.save.too_many_reactions",
      );
    }
    const joined = postReactionBadges(
      postId,
      member.id,
      (await memberApi.getReactions({ postId })) ?? [],
    );
    assert.deepEqual(joined.get("thumbsup"), { count: 2, own: true });
    assert.equal(
      postReactionDecision(joined, "thumbsup", "toggle", access),
      "remove",
    );
    await memberApi.deleteReaction({
      postId,
      userId: "me",
      emojiName: "thumbsup",
    });
    const left = postReactionBadges(
      postId,
      member.id,
      (await memberApi.getReactions({ postId })) ?? [],
    );
    assert.deepEqual(left.get("thumbsup"), { count: 1, own: false });
  } finally {
    await setLimit(previous);
  }
}
