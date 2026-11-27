import assert from "node:assert/strict";
import { readPostFiles } from "../../../src/mattermost/post-attachments.ts";
import {
  ChannelsApi,
  Configuration,
  PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";
import { uploadFixtureFile } from "./file-upload.ts";

export async function checkAccountPostFiles(
  basePath: string,
  channelId: string,
  ownerToken: string,
  readerToken: string,
  readerId: string,
  version: string,
) {
  const ownerConfig = new Configuration({ basePath, accessToken: ownerToken });
  const owner = new PostsApi(ownerConfig);
  const reader = new PostsApi(
    new Configuration({ basePath, accessToken: readerToken }),
  );
  const auth = { Authorization: `Bearer ${ownerToken}` };
  const a = await uploadFixtureFile(basePath, auth, channelId, "a.txt", "a");
  const b = await uploadFixtureFile(basePath, auth, channelId, "b.txt", "bb");
  const root = await owner.createPost({
    createPostRequest: { channelId, message: "Files in a private channel" },
  });
  assert.ok(root.id);
  const reply = await owner.createPost({
    createPostRequest: {
      channelId,
      rootId: root.id,
      message: "Two attached files",
      fileIds: [b, a],
    },
  });
  assert.ok(reply.id);
  const postId = reply.id;
  const expected = new Map([
    [a, { name: "a.txt", size: 1 }],
    [b, { name: "b.txt", size: 2 }],
  ]);
  async function details(posts: PostsApi) {
    let wireOrder: string[] | undefined;
    const files = await readPostFiles(
      {
        async getFileInfosForPostRaw(params, init) {
          const response = await posts.getFileInfosForPostRaw(params, init);
          const wire: { id: string }[] = await response.raw.clone().json();
          wireOrder = wire.map((file) => file.id);
          return response;
        },
      },
      channelId,
      postId,
    );
    assert.deepEqual(
      files.map((file) => file.id),
      wireOrder,
    );
    assert.equal(files.length, expected.size);
    assert.deepEqual(
      new Set(files.map((file) => file.id)),
      new Set(expected.keys()),
    );
    for (const file of files) {
      assert.deepEqual(
        { name: file.name, size: file.size },
        expected.get(file.id),
      );
    }
  }
  assert.deepEqual(await readPostFiles(reader, channelId, root.id), []);
  await details(reader);
  const removal = await new ChannelsApi(ownerConfig).removeUserFromChannel({
    channelId,
    userId: readerId,
  });
  assert.equal(removal.status, "OK");
  await assert.rejects(
    details(reader),
    (error: unknown) =>
      error instanceof ResponseError && error.response.status === 403,
  );
  await details(owner);
  console.log(
    `Mattermost ${version} verified ordered post files for two ordinary accounts and denied the former private-channel member.`,
  );
}
