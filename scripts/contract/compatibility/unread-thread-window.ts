import assert from "node:assert/strict";
import { openThreadReplyWindow } from "../../../src/channels/thread-reply-window.ts";
import {
  readThreadPage,
  type ThreadPageRequest,
} from "../../../src/mattermost/thread-page.ts";
import type { PostsApi } from "../../../vendor/mattermost/index.js";

export async function checkUnreadThreadWindow(
  reader: PostsApi,
  readerId: string,
  channelId: string,
  seed: (
    message: string,
    rootId?: string,
    createAt?: number,
  ) => Promise<{ id: string; create_at: number }>,
  version: string,
) {
  const time = Date.now() - 480000;
  const root = await seed(
    "Discussion at the read boundary",
    undefined,
    time - 1000,
  );
  const one = await seed("First reply at the boundary", root.id, time);
  const two = await seed("Second reply at the boundary", root.id, time);
  assert.equal(one.create_at, time);
  assert.equal(two.create_at, time);
  const own = await reader.createPost({
    createPostRequest: {
      channelId,
      rootId: root.id,
      message: "My reply after the boundary",
    },
  });
  assert.ok(own.id && own.createAt && own.createAt > time);
  const account = {
    readThreadPage: (q: ThreadPageRequest, signal?: AbortSignal) =>
      readThreadPage(reader, { ...q, perPage: 1 }, signal),
  };
  const open = (collapsedThreads: boolean) =>
    openThreadReplyWindow(
      account,
      { channelId, rootId: root.id, collapsedThreads },
      { lastViewedAt: time, userId: readerId },
    );
  for (const collapsed of [true, false]) {
    const view = open(collapsed);
    try {
      await view.open();
      assert.equal(view.getSnapshot().down.status, "end");
      assert.deepEqual(view.getUnreadPosition(), { kind: "none" });
      for (let i = 0; view.getSnapshot().up.status === "ready"; i++) {
        assert.ok(i < 4);
        await view.more("up");
      }
      assert.equal(view.getSnapshot().up.status, "end");
      assert.deepEqual(
        view.getSnapshot().replies.map((p) => p.id),
        [...[one.id, two.id].sort(), own.id],
      );
    } finally {
      view.close();
    }
  }
  const last = await seed(
    "A newly arrived reply from another participant",
    root.id,
  );
  assert.ok(last.create_at > own.createAt);
  for (const collapsed of [true, false]) {
    const view = open(collapsed);
    try {
      await view.open();
      assert.equal(view.getSnapshot().down.status, "ready");
      assert.deepEqual(view.getUnreadPosition(), { kind: "pending" });
      await view.more("down");
      assert.equal(view.getSnapshot().down.status, "end");
      assert.deepEqual(view.getUnreadPosition(), {
        kind: "found",
        postId: last.id,
      });
    } finally {
      view.close();
    }
  }
  console.log(
    `Mattermost ${version} verified a time-only thread window, tied read replies, an own reply, continuation and a newly arrived foreign reply.`,
  );
}
