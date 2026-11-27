import assert from "node:assert/strict";
import { openThreadReplyWindow } from "../../../src/channels/thread-reply-window.ts";
import { channelHistoryPage } from "../../../src/mattermost/channel-history-page.ts";
import { readPostAnchor } from "../../../src/mattermost/message-anchors.ts";
import { readThreadPage } from "../../../src/mattermost/thread-page.ts";
import type { PostsApi } from "../../../vendor/mattermost/index.js";

export async function checkPostWebhookOrigin(
  base: string,
  token: string,
  posts: PostsApi,
  channelId: string,
  ownerId: string,
  version: string,
) {
  const regular = await posts.createPost({
    createPostRequest: { channelId, message: "Written by the webhook owner" },
  });
  assert.ok(regular.id);
  const installed = await fetch(`${base}/api/v4/hooks/incoming`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel_id: channelId, display_name: "Fixture" }),
  });
  assert.equal(installed.status, 201);
  const hook = await installed.json();
  assert.equal(hook.user_id, ownerId);
  assert.match(hook.id, /^[a-z0-9]{26}$/u);

  const text = "Delivered by the same owner's incoming webhook";
  const delivered = await fetch(`${base}/hooks/${hook.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  assert.equal(delivered.status, 200);
  const page = { channelId, page: 0, perPage: 60 };
  const received = await posts.getPostsForChannel(page);
  const hookPost = Object.values(received.posts ?? {}).find(
    (post) => post.message === text,
  );
  assert.ok(hookPost?.id);
  const webhookId = hookPost.id;
  const marker = (props: object | undefined) =>
    props && Object.getOwnPropertyDescriptor(props, "from_webhook")?.value;
  assert.equal(marker(hookPost.props), "true");
  assert.ok(hookPost.props);
  assert.ok(!Object.hasOwn(hookPost.props, "override_username"));
  assert.ok(!Object.hasOwn(hookPost.props, "override_icon_url"));
  assert.equal(marker(received.posts?.[regular.id]?.props), undefined);
  assert.equal(hookPost.userId, ownerId);
  assert.equal(received.posts?.[regular.id]?.userId, ownerId);

  const history = channelHistoryPage(
    { channelId, collapsedThreads: false },
    received,
  );
  const projected = new Map(
    history.changes
      .filter((change) => change.kind === "save")
      .map((change) => [change.id, change]),
  );
  assert.equal(projected.get(webhookId)?.fromWebhook, true);
  assert.equal(projected.get(regular.id)?.fromWebhook, false);
  for (const row of projected.values()) assert.ok(!Object.hasOwn(row, "props"));

  const older = await posts.getPostsForChannel({ ...page, before: webhookId });
  const previous = channelHistoryPage(
    { channelId, collapsedThreads: false, before: webhookId },
    older,
  );
  assert.ok(
    previous.changes.some(
      (change) =>
        change.kind === "save" &&
        change.id === regular.id &&
        change.fromWebhook === false,
    ),
  );
  assert.equal(
    (await readPostAnchor(posts, webhookId)).post?.fromWebhook,
    true,
  );
  assert.equal(
    (await readPostAnchor(posts, regular.id)).post?.fromWebhook,
    false,
  );

  const reply = await posts.createPost({
    createPostRequest: {
      channelId,
      rootId: webhookId,
      message: "Manual reply to the webhook",
    },
  });
  const thread = openThreadReplyWindow(
    { readThreadPage: (query, signal) => readThreadPage(posts, query, signal) },
    { channelId, rootId: webhookId, collapsedThreads: true },
  );
  try {
    await thread.open();
    assert.equal(thread.getSnapshot().root?.fromWebhook, true);
    assert.deepEqual(
      thread.getSnapshot().replies.map(({ id, fromWebhook }) => ({
        id,
        fromWebhook,
      })),
      [{ id: reply.id, fromWebhook: false }],
    );
  } finally {
    thread.close();
  }

  const messageOnly = await posts.patchPost({
    postId: webhookId,
    patchPostRequest: { message: "Edited webhook text" },
  });
  const replaced = await posts.patchPost({
    postId: webhookId,
    patchPostRequest: { message: "Edited with replacement props", props: {} },
  });
  assert.equal(marker(messageOnly.props), "true");
  assert.ok(replaced.updateAt && hookPost.updateAt);
  assert.ok(replaced.updateAt > hookPost.updateAt);
  // The older server honors the map replacement. The newer server
  // restores the verified integration identity for a regular edit.
  const flagAfterReplacement = version === "12.1.0";
  assert.equal(
    marker(replaced.props),
    flagAfterReplacement ? "true" : undefined,
  );
  assert.equal(
    (await readPostAnchor(posts, webhookId)).post?.fromWebhook,
    flagAfterReplacement,
  );
  console.log(
    `Mattermost ${version} verified webhook origin through channel, older page, thread and anchor; full props replacement retained marker: ${flagAfterReplacement}.`,
  );
}
