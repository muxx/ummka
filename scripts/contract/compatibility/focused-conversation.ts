import assert from "node:assert/strict";
import { prepareFocusedConversation } from "../../../src/channels/prepare-focused-conversation.ts";
import { refreshChannelHistory } from "../../../src/mattermost/channel-history-refresh.ts";
import { channelPostChange } from "../../../src/mattermost/channel-post-records.ts";
import type {
  LocalChannelWindow,
  LocalPost,
} from "../../../src/mattermost/local-history.ts";
import {
  type PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkFocusedConversation(
  author: PostsApi,
  reader: PostsApi,
  channelId: string,
  revokeAccess: () => Promise<unknown>,
) {
  const send = (message: string, rootId?: string) =>
    author.createPost({ createPostRequest: { channelId, rootId, message } });
  const root = await send("Navigation beyond the first thread page");
  assert.ok(root.id);
  const rootId = root.id;
  // Each reply updates the same thread's metadata in Mattermost.
  for (let i = 0; i < 60; i++) {
    await send(`Navigation fixture ${i}`, rootId);
  }
  const last = await send("Exact reply beyond the first page", rootId);
  assert.ok(last.id);
  const first = await reader.getPostThread({
    postId: rootId,
    direction: "down",
    perPage: 60,
    collapsedThreads: true,
  });
  assert.equal(first.hasNext, true);
  assert.equal(first.order?.length, 61);
  assert.ok(first.posts?.[rootId]);
  assert.ok(!Object.hasOwn(first.posts, last.id));
  async function resolved(id: string) {
    const record = channelPostChange(
      channelId,
      id,
      await reader.getPost({ postId: id }),
    );
    assert.ok(record.kind === "save");
    return record;
  }
  const checkedRoot = await resolved(rootId);
  const checkedReply = await resolved(last.id);

  function coldWindow(
    target: LocalPost,
    collapsedThreads: boolean,
    anchor: string,
  ) {
    // Capture the real server page at the SQLite writer boundary. The WebView
    // acceptance runs this same operation against the native SQLite store.
    let committed: LocalChannelWindow | null = null;
    return prepareFocusedConversation(
      {
        async readChannelWindow(query) {
          assert.deepEqual(query, {
            kind: "around",
            channelId,
            collapsedThreads,
            postId: anchor,
            newer: 30,
            older: 30,
          });
          return committed;
        },
        refreshChannelHistory(query, signal) {
          assert.deepEqual(query, {
            kind: "focused",
            channelId,
            collapsedThreads,
            postId: anchor,
            perPage: 30,
          });
          return refreshChannelHistory(
            reader,
            {
              async begin(id) {
                assert.equal(id, channelId);
                return 1;
              },
              async store(_, page) {
                assert.deepEqual(page.source, {
                  kind: "focused",
                  postId: anchor,
                });
                const byId = new Map<string, LocalPost>();
                for (const change of page.changes)
                  if (change.kind === "save") byId.set(change.id, change);
                if (target === checkedReply && collapsedThreads)
                  assert.equal(byId.has(checkedReply.id), false);
                assert.equal(typeof page.prevPostId, "string");
                assert.equal(typeof page.nextPostId, "string");
                assert.equal(page.firstInaccessiblePostTime, 0);
                committed = {
                  posts: page.order.map((id) => {
                    const row = byId.get(id);
                    assert.ok(row);
                    return row;
                  }),
                  older: page.prevPostId
                    ? { kind: "more", postId: page.prevPostId }
                    : { kind: "end" },
                  newer: page.nextPostId
                    ? { kind: "more", postId: page.nextPostId }
                    : { kind: "end" },
                  firstInaccessiblePostTime: page.firstInaccessiblePostTime,
                };
                return { kind: "applied" };
              },
              async cancel() {},
            },
            query,
            signal,
          );
        },
      },
      target,
      collapsedThreads,
      new AbortController().signal,
    );
  }

  for (const [target, collapsedThreads, anchor] of [
    [checkedRoot, false, rootId],
    [checkedRoot, true, rootId],
    [checkedReply, true, rootId],
    [checkedReply, false, checkedReply.id],
  ] as const) {
    const result = await coldWindow(target, collapsedThreads, anchor);
    assert.equal(result.status, "ready");
    assert.equal(result.anchorId, anchor);
    assert.ok(result.page.posts.some((row) => row.id === anchor));
    assert.equal(
      result.focusedReply,
      target === checkedReply && collapsedThreads ? checkedReply : undefined,
    );
    assert.equal(
      result.page.posts.some((row) => row.id === checkedReply.id),
      target === checkedReply && !collapsedThreads,
    );
  }
  await revokeAccess();
  await assert.rejects(
    coldWindow(checkedReply, true, rootId),
    (error: unknown) =>
      error instanceof ResponseError &&
      [403, 404].includes(error.response.status),
  );
}
