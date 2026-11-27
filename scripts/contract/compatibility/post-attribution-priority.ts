import assert from "node:assert/strict";
import { openThreadReplyWindow } from "../../../src/channels/thread-reply-window.ts";
import { channelHistoryPage } from "../../../src/mattermost/channel-history-page.ts";
import { channelPostChange } from "../../../src/mattermost/channel-post-records.ts";
import {
  assembleFocusedHistory,
  readFocusedNeighbors,
} from "../../../src/mattermost/focused-history.ts";
import { readPostAnchor } from "../../../src/mattermost/message-anchors.ts";
import { editOwnPostMessage } from "../../../src/mattermost/own-post.ts";
import { readThreadPage } from "../../../src/mattermost/thread-page.ts";
import type { PostsApi } from "../../../vendor/mattermost/index.js";

export async function checkPostAttributionPriority(
  base: string,
  adminToken: string,
  posts: PostsApi,
  channelId: string,
  userId: string,
  version: string,
) {
  const send = (message: string) =>
    posts.createPost({ createPostRequest: { channelId, message } });
  const regular = await send("Ordinary signed message");
  const important = await posts.createPost({
    createPostRequest: {
      channelId,
      message: "Important signed message",
      metadata: { priority: { priority: "important" } },
    },
  });
  const reply = await posts.createPost({
    createPostRequest: {
      channelId,
      rootId: important.id,
      message: "Signed reply with an attributed source",
      props: { ai_generated_by: userId },
    },
  });
  const standard = await posts.createPost({
    createPostRequest: {
      channelId,
      message: "Explicit Standard",
      metadata: { priority: { priority: "" } },
    },
  });
  const urgent = await posts.createPost({
    createPostRequest: {
      channelId,
      message: "Urgent signed message",
      metadata: { priority: { priority: "urgent" } },
    },
  });
  assert.ok(regular.id && important.id && reply.id && standard.id && urgent.id);
  assert.equal(regular.userId, userId);
  assert.equal(important.userId, userId);
  assert.equal(important.type, "");
  assert.equal(important.metadata?.priority?.priority, "important");
  assert.equal(urgent.userId, userId);
  assert.equal(urgent.type, "");
  assert.equal(urgent.metadata?.priority?.priority, "urgent");
  assert.equal(standard.metadata?.priority?.priority, "");
  const ai = { kind: "source", userId, hasUsername: version === "12.1.0" };
  const sentReply = channelPostChange(channelId, reply.id, reply);
  const sentImportant = channelPostChange(channelId, important.id, important);
  assert.ok(sentReply.kind === "save" && sentImportant.kind === "save");
  assert.deepEqual(sentReply.aiAttribution, ai);
  assert.equal(sentImportant.displayPriority, "important");

  const edited = await editOwnPostMessage(
    posts,
    userId,
    {
      id: important.id,
      userId,
      channelId,
      rootId: null,
    },
    "Important after text edit",
  );
  assert.equal(edited.displayPriority, "important");

  for (const collapsedThreads of [false, true]) {
    const query = { channelId, collapsedThreads, page: 0, perPage: 20 };
    const latest = await posts.getPostsForChannel(query);
    const observed = channelHistoryPage(query, latest).changes;
    const byId = new Map(
      observed.filter((row) => row.kind === "save").map((row) => [row.id, row]),
    );
    assert.equal(byId.get(important.id)?.displayPriority, "important");
    assert.equal(byId.get(urgent.id)?.displayPriority, "urgent");
    assert.equal(byId.get(regular.id)?.displayPriority, "standard");
    assert.equal(byId.get(standard.id)?.displayPriority, "standard");
    assert.deepEqual(byId.get(regular.id)?.aiAttribution, { kind: "none" });

    const thread = await posts.getPostThread({
      postId: important.id,
      collapsedThreads,
      direction: "down",
      perPage: 60,
    });
    const neighbors = await readFocusedNeighbors(posts, {
      channelId,
      collapsedThreads,
      anchorId: important.id,
    });
    const focused = assembleFocusedHistory({
      channelId,
      collapsedThreads,
      anchorId: important.id,
      thread,
      ...neighbors,
    });
    assert.ok(
      focused.changes.some(
        (row) =>
          row.kind === "save" &&
          row.id === important.id &&
          row.displayPriority === "important",
      ),
    );

    const replies = openThreadReplyWindow(
      {
        readThreadPage: (request, signal) =>
          readThreadPage(posts, request, signal),
      },
      { channelId, collapsedThreads, rootId: important.id },
    );
    try {
      await replies.open();
      assert.equal(replies.getSnapshot().root?.displayPriority, "important");
      assert.deepEqual(
        replies.getSnapshot().replies.find((row) => row.id === reply.id)
          ?.aiAttribution,
        ai,
      );
    } finally {
      replies.close();
    }
  }
  const query = {
    channelId,
    collapsedThreads: false,
    before: standard.id,
    page: 0,
    perPage: 1,
  };
  const one = await posts.getPostsForChannel(query);
  assert.deepEqual(one.order, [reply.id]);
  assert.ok(one.posts?.[important.id]);
  assert.equal(one.posts[important.id].metadata?.priority, undefined);
  assert.ok(
    channelHistoryPage(query, one).changes.some(
      (row) =>
        row.kind === "save" &&
        row.id === important.id &&
        !Object.hasOwn(row, "displayPriority"),
    ),
  );
  assert.deepEqual(
    (await readPostAnchor(posts, reply.id)).post?.aiAttribution,
    ai,
  );

  const headers = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
  const config = await fetch(`${base}/api/v4/config`, { headers });
  assert.equal(config.status, 200);
  const initial = (await config.json()).ServiceSettings.PostPriority;
  assert.equal(initial, true);
  function setPriority(enabled: boolean) {
    return fetch(`${base}/api/v4/config/patch`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ServiceSettings: { PostPriority: enabled } }),
    });
  }
  const enabled = (await readPostAnchor(posts, important.id)).post;
  assert.equal(enabled?.displayPriority, "important");
  const enabledUrgent = (await readPostAnchor(posts, urgent.id)).post;
  assert.equal(enabledUrgent?.displayPriority, "urgent");
  try {
    assert.equal((await setPriority(false)).status, 200);
    const disabled = (await readPostAnchor(posts, important.id)).post;
    assert.equal(disabled?.displayPriority, "standard");
    assert.equal(disabled?.updateAt, enabled.updateAt);
    const disabledUrgent = (await readPostAnchor(posts, urgent.id)).post;
    assert.equal(disabledUrgent?.displayPriority, "standard");
    assert.equal(disabledUrgent.updateAt, enabledUrgent.updateAt);
    const latestRequest = { channelId, collapsedThreads: true };
    const read = await posts.getPostsForChannel(latestRequest);
    assert.ok(
      channelHistoryPage(latestRequest, read).changes.some(
        (row) =>
          row.kind === "save" &&
          row.id === important.id &&
          row.displayPriority === "standard",
      ),
    );
  } finally {
    assert.equal((await setPriority(initial)).status, 200);
  }
  const restored = (await readPostAnchor(posts, important.id)).post;
  assert.equal(restored?.displayPriority, "important");
  assert.equal(restored?.updateAt, enabled.updateAt);
  const restoredUrgent = (await readPostAnchor(posts, urgent.id)).post;
  assert.equal(restoredUrgent?.displayPriority, "urgent");
  assert.equal(restoredUrgent.updateAt, enabledUrgent.updateAt);
  console.log(
    `Mattermost ${version} verified attributed replies, ordered and extra rows, edit confirmation, focused reads and Important/Urgent → Standard → Important/Urgent at unchanged updateAt.`,
  );
}
