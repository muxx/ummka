import assert from "node:assert/strict";
import type { channelHistoryPage } from "../../../src/mattermost/channel-history-page.ts";
import {
  type ChannelRefreshRequest,
  refreshChannelHistory,
} from "../../../src/mattermost/channel-history-refresh.ts";
import type { PostsApi } from "../../../vendor/mattermost/index.js";

export async function verifyHistoryRefresh(
  api: PostsApi,
  channelId: string,
  root: string,
  reply: string,
  sinceEdit: number,
  sinceDelete: number,
  removed: string[],
) {
  async function capture(query: ChannelRefreshRequest) {
    const saved: ReturnType<typeof channelHistoryPage>[] = [];
    let begun = false;
    const result = await refreshChannelHistory(
      api,
      {
        async begin(id) {
          assert.equal(id, channelId);
          begun = true;
          return 19;
        },
        async store(handle, page) {
          assert(begun);
          assert.equal(handle, 19);
          saved.push(page);
          return { kind: "applied" };
        },
        async cancel() {
          assert.fail("The real server should return a valid page.");
        },
      },
      query,
    );
    assert.equal(result.kind, "applied");
    assert.equal(saved.length, 1);
    return saved[0];
  }
  for (const collapsedThreads of [false, true]) {
    const scope = { channelId, collapsedThreads };
    const latest = await capture({ ...scope, kind: "latest" });
    assert.ok(latest.order.includes(root));
    assert.equal(latest.order.includes(reply), !collapsedThreads);
    for (const kind of ["before", "after"] as const) {
      const next = await capture({ ...scope, kind, postId: root, perPage: 1 });
      assert.deepEqual(next.source, { kind, postId: root });
      assert.equal(next.order.length, 1);
      assert.ok(!next.order.includes(root));
    }
    const focused = await capture({
      ...scope,
      kind: "focused",
      postId: root,
      perPage: 1,
    });
    assert.deepEqual(focused.source, { kind: "focused", postId: root });
    assert.equal(focused.order[1], root);
    assert.equal(focused.order.length, 3);
    assert.ok(
      focused.changes.some(
        (change) =>
          change.id === reply &&
          change.kind === "save" &&
          change.rootId === root,
      ),
    );
  }
  const ordinary = { channelId, collapsedThreads: false };
  const edits = await capture({ ...ordinary, kind: "since", since: sinceEdit });
  assert.ok(
    edits.changes.some(
      (change) =>
        change.id === root &&
        change.kind === "save" &&
        change.message === "Edited earlier root",
    ),
  );
  const deletions = await capture({
    ...ordinary,
    kind: "since",
    since: sinceDelete,
  });
  for (const id of removed)
    assert.ok(
      deletions.changes.some(
        (change) => change.kind === "remove" && change.id === id,
      ),
    );
}
