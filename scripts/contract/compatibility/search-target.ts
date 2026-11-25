import assert from "node:assert/strict";
import { inspectPostTarget } from "../../../src/channels/inspect-post-target.ts";
import {
  readFileAnchor,
  readPostAnchor,
} from "../../../src/mattermost/message-anchors.ts";
import { readPostDestination } from "../../../src/mattermost/post-destination.ts";
import {
  type Configuration,
  FilesApi,
  PostsApi,
} from "../../../vendor/mattermost/index.js";

export async function checkMessageTarget(
  session: Configuration,
  fileId: string,
  postId: string,
  channelId: string,
  teamId: string,
) {
  const files = new FilesApi(session),
    posts = new PostsApi(session);
  const account = {
    readFileAnchor: (id: string) => readFileAnchor(files, id),
    readPostAnchor: (id: string) => readPostAnchor(posts, id),
    readPostDestination: (id: string) => readPostDestination(posts, id),
  };
  const expected = { kind: "ready", teamId, channelId, postId, rootId: null };
  assert.deepEqual(
    await inspectPostTarget(account, { kind: "file", id: fileId }, null),
    expected,
  );
  assert.deepEqual(
    await inspectPostTarget(account, { kind: "post", id: postId }, null),
    expected,
  );
}
