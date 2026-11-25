import assert from "node:assert/strict";
import { openThreadReplyWindow } from "../../../src/channels/thread-reply-window.ts";
import { channelPostChange } from "../../../src/mattermost/channel-post-records.ts";
import {
  readThreadPage,
  type ThreadPageRequest,
} from "../../../src/mattermost/thread-page.ts";
import type { PostsApi } from "../../../vendor/mattermost/index.js";

export async function checkThreadWindow(
  posts: PostsApi,
  channelId: string,
  rootId: string,
  chronological: string[],
) {
  const id = chronological[1];
  const focused = channelPostChange(
    channelId,
    id,
    await posts.getPost({ postId: id }),
  );
  assert.equal(focused.kind, "save");
  for (const collapsedThreads of [true, false]) {
    let requests = 0;
    const account = {
      readThreadPage(query: ThreadPageRequest, signal?: AbortSignal) {
        requests++;
        return readThreadPage(posts, { ...query, perPage: 1 }, signal);
      },
    };
    const view = openThreadReplyWindow(
      account,
      { channelId, rootId, collapsedThreads },
      focused,
    );
    try {
      assert.deepEqual(
        view.getSnapshot().replies.map((row) => row.id),
        [id],
      );
      await view.open();
      assert.equal(requests, 2);
      for (const direction of ["up", "down"] as const) {
        while (view.getSnapshot()[direction].status === "ready") {
          assert.ok(requests < 12, "thread window did not advance");
          await view.more(direction);
        }
        assert.equal(view.getSnapshot()[direction].status, "end");
      }
      assert.equal(view.getSnapshot().root?.id, rootId);
      assert.deepEqual(
        view.getSnapshot().replies.map((row) => row.id),
        chronological,
      );
    } finally {
      view.close();
    }
  }
}
