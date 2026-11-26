import assert from "node:assert/strict";
import { inspectPostTarget } from "../../../src/channels/inspect-post-target.ts";
import type { LocalPost } from "../../../src/mattermost/local-history.ts";
import {
  readFileAnchor,
  readPostAnchor,
} from "../../../src/mattermost/message-anchors.ts";
import { readPostDestination } from "../../../src/mattermost/post-destination.ts";
import {
  type Configuration,
  FilesApi,
  type Post,
  PostsApi,
} from "../../../vendor/mattermost/index.js";

export function expectedNavigationPost(
  row: Post,
  attachments: LocalPost["attachments"] = { fileIds: [] },
) {
  return {
    attachments,
    id: row.id,
    channelId: row.channelId,
    rootId: row.rootId || null,
    userId: row.userId,
    createAt: row.createAt,
    updateAt: row.updateAt,
    editAt: row.editAt,
    type: row.type,
    message: row.message,
    messageSource: row.messageSource ?? null,
    hashtags: row.hashtags,
    isPinned: row.isPinned,
  };
}

export async function checkMessageTarget(
  session: Configuration,
  fileId: string,
  postId: string,
  created: Post,
  teamId: string,
) {
  const files = new FilesApi(session),
    posts = new PostsApi(session);
  const account = {
    readFileAnchor: (id: string) => readFileAnchor(files, id),
    readPostAnchor: (id: string) => readPostAnchor(posts, id),
    readPostDestination: (id: string) => readPostDestination(posts, id),
  };
  assert.ok(created.rootId && created.userId && created.createAt);
  const { name, extension, mimeType, size, archived } = await files.getFileInfo(
    { fileId },
  );
  const expected = {
    kind: "ready",
    teamId,
    channelId: created.channelId,
    postId,
    rootId: created.rootId,
    post: expectedNavigationPost(created, {
      fileIds: [fileId],
      files: [{ id: fileId, name, extension, mimeType, size, archived }],
    }),
  };
  assert.deepEqual(
    await inspectPostTarget(account, { kind: "file", id: fileId }, null),
    expected,
  );
  assert.deepEqual(
    await inspectPostTarget(account, { kind: "post", id: postId }, null),
    expected,
  );
}
