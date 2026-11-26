import assert from "node:assert/strict";
import {
  type PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkPostEditHistory(
  author: PostsApi,
  peer: PostsApi,
  anonymous: PostsApi,
  authorId: string,
  channelId: string,
  version: string,
) {
  const texts = [
    "history-fixture first version",
    "history-fixture second version",
    "history-fixture current version",
  ];
  const root = await author.createPost({
    createPostRequest: { channelId, message: "Edit history fixture" },
  });
  assert.ok(root.id);
  const reply = await author.createPost({
    createPostRequest: { channelId, rootId: root.id, message: texts[0] },
  });
  assert.ok(reply.id);
  const query = { postId: reply.id };
  async function expectUnavailable(client: PostsApi, status: number) {
    const response = await client.getEditHistoryForPostRaw(query).then(
      () => assert.fail("Expected an unavailable edit history"),
      (error: unknown) => {
        assert.ok(error instanceof ResponseError);
        return error.response;
      },
    );
    assert.equal(response.status, status);
    const body = await response.text();
    assert.ok(JSON.parse(body).id);
    for (const text of texts) assert.ok(!body.includes(text));
  }
  await expectUnavailable(author, 404);
  for (const message of texts.slice(1)) {
    const edited = await author.patchPost({
      ...query,
      patchPostRequest: { message },
    });
    assert.equal(edited.message, message);
  }
  const current = await author.getPost(query);
  assert.equal(current.id, reply.id);
  assert.equal(current.message, texts[2]);
  const previous = await author.getEditHistoryForPost(query);
  assert.deepEqual(
    previous.map((row) => row.message),
    [texts[1], texts[0]],
  );
  const ids = new Set([reply.id]);
  for (const row of previous) {
    assert.ok(row.id && !ids.has(row.id));
    ids.add(row.id);
    assert.equal(row.originalId, reply.id);
    assert.equal(row.rootId, root.id);
    assert.equal(row.channelId, channelId);
    assert.equal(row.userId, authorId);
    assert.ok(row.deleteAt && row.deleteAt > 0);
  }
  assert.ok(previous[0].editAt && previous[0].editAt > 0);
  assert.equal(previous[1].editAt, 0);
  assert.equal((await peer.getPost(query)).message, current.message);
  await expectUnavailable(peer, 403);
  await expectUnavailable(anonymous, 401);
  assert.equal((await author.deletePost(query)).status, "OK");
  await expectUnavailable(author, 403);
  console.log(
    `Mattermost ${version} verified the author's edit history, version order, no-history response and reader permissions.`,
  );
}
