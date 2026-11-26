import assert from "node:assert/strict";
import { openThreadReplyWindow } from "../../../src/channels/thread-reply-window.ts";
import { channelHistoryPage } from "../../../src/mattermost/channel-history-page.ts";
import type { LocalPost } from "../../../src/mattermost/local-history.ts";
import { readPostAnchor } from "../../../src/mattermost/message-anchors.ts";
import { readThreadPage } from "../../../src/mattermost/thread-page.ts";
import type { PostsApi } from "../../../vendor/mattermost/index.js";

interface PostedFiles {
  id: string;
  file_ids: string[];
  metadata: { files: { id: string; name: string; size: number }[] };
}

export async function checkPostAttachments(
  owner: PostsApi,
  reader: PostsApi,
  upload: (name: string, content: string) => Promise<string>,
  channelId: string,
  rootId: string,
  version: string,
) {
  const a = await upload("receipt-a.txt", "first");
  const b = await upload("receipt-b.txt", "second");
  const ids = [b, a];
  const created = await owner.createPost({
    createPostRequest: {
      channelId,
      rootId,
      message: "Two attachments",
      fileIds: ids,
    },
  });
  const id = created.id;
  assert.ok(id);
  // 10.10.1 sorts IDs while removing duplicates in Post.PreSave.
  // Both releases send their resulting order to readers.
  const exactIds = [...ids].sort();
  assert.ok(created.fileIds);
  assert.deepEqual([...created.fileIds].sort(), exactIds);
  const names = (order: string[]) =>
    order.map((file) => (file === a ? "A" : "B")).join(",");
  const orders = [`create IDs ${names(created.fileIds)}`];
  function verify(
    scope: string,
    row: LocalPost | null | undefined,
    wire: PostedFiles | undefined,
  ) {
    assert.ok(wire);
    assert.equal(wire.id, id);
    assert.deepEqual([...wire.file_ids].sort(), exactIds);
    const files = wire.metadata.files;
    const fileOrder = files.map((file) => file.id);
    assert.deepEqual([...fileOrder].sort(), exactIds);
    for (const file of files) {
      assert.equal(
        file.name,
        file.id === a ? "receipt-a.txt" : "receipt-b.txt",
      );
      assert.equal(file.size, file.id === a ? 5 : 6);
    }
    assert.equal(row?.id, id);
    assert.equal(row?.channelId, channelId);
    assert.equal(row?.rootId, rootId);
    assert.deepEqual(row.attachments?.fileIds, wire.file_ids);
    assert.deepEqual(
      row.attachments?.files?.map((file) => [file.id, file.name, file.size]),
      files.map((file) => [file.id, file.name, file.size]),
    );
    assert.equal(row.attachments?.redactedFileCount, undefined);
    orders.push(
      `${scope} IDs ${names(wire.file_ids)}, descriptions ${names(fileOrder)}`,
    );
  }

  const request = { channelId, collapsedThreads: false, perPage: 60 };
  const response = await reader.getPostsForChannelRaw(request);
  const channelSource = await response.raw.clone().json();
  const change = channelHistoryPage(
    request,
    await response.value(),
  ).changes.find((row) => row.id === id);
  assert.ok(change?.kind === "save");
  verify("channel", change, channelSource.posts[id]);

  let threadSource: PostedFiles | undefined;
  const window = openThreadReplyWindow(
    {
      readThreadPage: (query, signal) =>
        readThreadPage(
          {
            async getPostThread(parameters, options) {
              const response = await reader.getPostThreadRaw(
                parameters,
                options,
              );
              threadSource = (await response.raw.clone().json()).posts[id];
              return response.value();
            },
          },
          query,
          signal,
        ),
    },
    { channelId, rootId, collapsedThreads: true },
  );
  try {
    await window.open();
    const state = window.getSnapshot();
    if (state.down.status === "error") throw state.down.error;
    verify(
      "thread",
      state.replies.find((row) => row.id === id),
      threadSource,
    );
  } finally {
    window.close();
  }

  let anchorSource: PostedFiles | undefined;
  const anchor = await readPostAnchor(
    {
      async getPost(parameters, options) {
        const response = await reader.getPostRaw(parameters, options);
        anchorSource = await response.raw.clone().json();
        return response.value();
      },
    },
    id,
  );
  verify("anchor", anchor.post, anchorSource);
  console.log(
    `Mattermost ${version} received attachment order: ${orders.join("; ")}.`,
  );
}
