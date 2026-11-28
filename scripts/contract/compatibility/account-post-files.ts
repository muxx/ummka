import assert from "node:assert/strict";
import type { PendingPost } from "../../../src/mattermost/account-delivery.ts";
import { readChannelFile } from "../../../src/mattermost/message-anchors.ts";
import { readPostFiles } from "../../../src/mattermost/post-attachments.ts";
import { deliverAccountPost } from "../../../src/mattermost/send-account-post.ts";
import {
  ChannelsApi,
  Configuration,
  FilesApi,
  PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";
import { uploadFixtureFile } from "./file-upload.ts";

async function checkQueuedDelivery(
  basePath: string,
  auth: { Authorization: string },
  posts: PostsApi,
  channelId: string,
  ownerId: string,
  version: string,
) {
  const upload = async (name: string) => ({
    id: await uploadFixtureFile(basePath, auth, channelId, name, "contents"),
    name,
    size: 8,
  });
  const queued = (
    rootId: string | null,
    message: string,
    files: PendingPost["files"],
  ): PendingPost => ({
    sequence: 1,
    pendingId: `${ownerId}:${crypto.randomUUID()}`,
    channelId,
    rootId,
    message,
    files,
    createdAt: 1,
    previousLogin: false,
    confirmedPostId: null,
    attempt: 1,
    refusal: null,
  });
  let creates = 0;
  const deliver = async (pending: PendingPost) => {
    let returnedKey = "no response";
    const result = await deliverAccountPost(
      {
        async createPost(request) {
          creates += 1;
          assert.deepEqual(
            request.createPostRequest.fileIds,
            pending.files.map((file) => file.id),
          );
          const response = await posts.createPostRaw(request);
          assert.equal(response.raw.status, 201);
          const post = await response.value();
          returnedKey =
            post.pendingPostId === ""
              ? "empty"
              : post.pendingPostId === undefined
                ? "omitted"
                : post.pendingPostId === pending.pendingId
                  ? "matching"
                  : "different";
          return post;
        },
      },
      ownerId,
      pending,
      {
        async confirmPostDelivery(source, canonical) {
          assert.equal(source.requestPendingId, pending.pendingId);
          assert.equal(canonical.channelId, channelId);
          assert.equal(canonical.rootId, pending.rootId ?? "");
          return true;
        },
        async recordPostRefusal() {
          assert.fail("The uploaded files should be accepted");
        },
      },
    );
    assert.ok(
      result.kind === "accepted" && result.matched,
      `Mattermost ${version}, attempt ${pending.attempt}: ${result.kind}, returned pending ID ${returnedKey}`,
    );
    assert.ok(result.post.id);
    return { ...result.post, id: result.post.id };
  };
  const first = await upload("a-queued.txt");
  const second = await upload("b-queued.txt");
  const channel = await deliver(
    queued(null, "Two queued files", [second, first]),
  );
  assert.deepEqual(new Set(channel.fileIds), new Set([first.id, second.id]));
  const single = await upload("file-only-reply.txt");
  const thread = await deliver(queued(channel.id, "", [single]));
  assert.equal(thread.message, "");
  assert.deepEqual(thread.fileIds, [single.id]);
  const kept = await upload("partial-reply.txt");
  const partial = queued(channel.id, "", [
    { id: "x".repeat(26), name: "missing.txt", size: 1 },
    kept,
  ]);
  const accepted = await deliver(partial);
  assert.equal(accepted.message, "");
  assert.deepEqual(accepted.fileIds, [kept.id]);
  const replay = await deliver({ ...partial, attempt: 2 });
  assert.equal(replay.id, accepted.id);
  assert.equal(replay.pendingPostId, "");
  assert.deepEqual(replay.fileIds, [kept.id]);
  const stored = await posts.getPost({ postId: accepted.id });
  assert.deepEqual(stored.fileIds, [kept.id]);
  assert.deepEqual(
    (await readPostFiles(posts, channelId, accepted.id)).map((file) => file.id),
    [kept.id],
  );
  assert.equal(creates, 4);
  console.log(
    `Mattermost ${version} confirmed ordered queued files, a file-only reply and a partially attached post with a stable retry ID.`,
  );
}

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
  const uploader = new FilesApi(
    new Configuration({ basePath, accessToken: readerToken }),
  );
  const uploadName = "план смены.txt";
  const file = new File(["✓"], uploadName, { type: "text/plain" });
  const upload = { channelId, clientIds: "upload-ordinary", files: file };
  for (const bookmark of [undefined, true]) {
    const clientIds = bookmark ? "upload-bookmark" : upload.clientIds;
    const response = await uploader.uploadFileRaw({
      ...upload,
      clientIds,
      bookmark,
    });
    assert.equal(response.raw.status, 201);
    const receipt = await response.value();
    assert.deepEqual(receipt.clientIds, [clientIds]);
    assert.equal(receipt.fileInfos?.length, 1);
    const record = receipt.fileInfos[0];
    assert.match(record.id ?? "", /^[a-z0-9]{26}$/);
    assert.equal(record.channelId, channelId);
    assert.equal(record.name, file.name);
    assert.equal(record.size, file.size);
    assert.equal(record.userId, bookmark ? "bookmark" : readerId);
    assert.ok(!record.postId);
  }
  await assert.rejects(
    new FilesApi(new Configuration({ basePath })).uploadFile(upload),
    (e: unknown) => e instanceof ResponseError && e.response.status === 401,
  );
  const auth = { Authorization: `Bearer ${ownerToken}` };
  const a = await uploadFixtureFile(basePath, auth, channelId, "a.txt", "a");
  const b = await uploadFixtureFile(basePath, auth, channelId, "b.txt", "bb");
  const root = await owner.createPost({
    createPostRequest: { channelId, message: "Files in a private channel" },
  });
  assert.ok(root.id);
  assert.ok(root.userId);
  await checkQueuedDelivery(
    basePath,
    auth,
    owner,
    channelId,
    root.userId,
    version,
  );
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
  const readerFiles = new FilesApi(
    new Configuration({ basePath, accessToken: readerToken }),
  );
  const selected = await readChannelFile(readerFiles, channelId, b);
  assert.equal(selected.file.id, b);
  assert.equal(selected.file.size, 2);
  assert.equal(selected.postId, postId);
  await assert.rejects(
    readChannelFile(readerFiles, "x".repeat(26), b),
    /another channel/,
  );
  const removal = await new ChannelsApi(ownerConfig).removeUserFromChannel({
    channelId,
    userId: readerId,
  });
  assert.equal(removal.status, "OK");
  await assert.rejects(
    uploader.uploadFile({ ...upload, bookmark: true }),
    (e: unknown) => e instanceof ResponseError && e.response.status === 403,
  );
  console.log(
    `Mattermost ${version} verified named post and bookmark uploads, echoed client IDs, and denied anonymous and removed uploaders.`,
  );
  await assert.rejects(
    details(reader),
    (error: unknown) =>
      error instanceof ResponseError && error.response.status === 403,
  );
  await assert.rejects(
    readChannelFile(readerFiles, channelId, b),
    (e: unknown) => e instanceof ResponseError && e.response.status === 403,
  );
  await details(owner);
  console.log(
    `Mattermost ${version} verified ordered post files for two ordinary accounts and denied the former private-channel member.`,
  );
}
