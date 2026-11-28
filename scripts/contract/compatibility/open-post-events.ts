import assert from "node:assert/strict";
import { applyOpenChannelEvents } from "../../../src/channels/open-channel-events.ts";
import { openThreadReplyWindow } from "../../../src/channels/thread-reply-window.ts";
import type { ChannelPostChange } from "../../../src/mattermost/account-channel-events.ts";
import {
  type ChannelRefreshRequest,
  refreshChannelHistory,
} from "../../../src/mattermost/channel-history-refresh.ts";
import { applyPostEventHistory } from "../../../src/mattermost/channel-post-event-history.ts";
import type { ChannelPostChange as LocalChange } from "../../../src/mattermost/channel-post-records.ts";
import { readThreadPage } from "../../../src/mattermost/thread-page.ts";
import type { PostsApi } from "../../../vendor/mattermost/index.js";

/** Exercise the actual workspace consumer over signed REST with an in-memory write receipt. */
export function openPostEventFlow(
  viewer: PostsApi,
  channelId: string,
  collapsedThreads: boolean,
) {
  const signal = new AbortController().signal;
  const rows = new Map<string, Extract<LocalChange, { kind: "save" }>>();
  const ordered = new Set<string>();
  const channelReads: ChannelRefreshRequest["kind"][] = [];
  const scope = { channelId, collapsedThreads };
  let thread: ReturnType<typeof openThreadReplyWindow> | null = null;
  let load = 0;
  function store(permit: number, changes: readonly LocalChange[]) {
    assert.equal(permit, load);
    for (const row of changes) {
      if (row.kind === "remove") {
        rows.delete(row.id);
        ordered.delete(row.id);
      } else rows.set(row.id, row);
    }
    return { kind: "applied" as const };
  }
  const permits = {
    async begin(id: string) {
      assert.equal(id, channelId);
      return ++load;
    },
    async cancel(permit: number) {
      assert.equal(permit, load);
    },
  };
  const account = {
    refreshChannelHistory(request: ChannelRefreshRequest, active: AbortSignal) {
      channelReads.push(request.kind);
      return refreshChannelHistory(
        viewer,
        {
          ...permits,
          async store(permit, page) {
            for (const id of page.order) ordered.add(id);
            return store(permit, page.changes);
          },
        },
        request,
        active,
      );
    },
    readSavedPost(id: string, postId: string) {
      assert.equal(id, channelId);
      return Promise.resolve(rows.get(postId) ?? null);
    },
    applyChannelPostEvents(
      id: string,
      addresses: readonly ChannelPostChange[],
      active: AbortSignal,
    ) {
      return applyPostEventHistory(
        viewer,
        {
          ...permits,
          store: async (permit, changes) => store(permit, changes),
        },
        id,
        addresses,
        active,
      );
    },
  };
  return {
    async apply(change: ChannelPostChange, text: string) {
      await applyOpenChannelEvents(
        account,
        { ...scope, page: null, visibleIds: [...rows.keys()], thread },
        { kind: "posts", changes: [change] },
        signal,
      );
      const { postId, kind, rootId } = change;
      if (kind === "created" && rootId === null) {
        assert.equal(rows.get(postId)?.message, text);
        thread = openThreadReplyWindow(
          {
            readThreadPage: (query, active) =>
              readThreadPage(viewer, query, active),
          },
          { ...scope, rootId: postId },
        );
        await thread.open();
      }
      assert.ok(thread);
      const state = thread.getSnapshot();
      if (rootId && kind !== "deleted") {
        assert.equal(
          state.replies.find(({ id }) => id === postId)?.message,
          text,
        );
        if (kind === "created")
          assert.equal(ordered.has(postId), !collapsedThreads);
      } else if (kind === "deleted") {
        assert.equal(rows.has(postId), false);
        assert.ok(!state.replies.some(({ id }) => id === postId));
        if (rootId === null) assert.equal(state.unavailable, "forbidden");
      }
    },
    verify() {
      assert.deepEqual(
        channelReads,
        collapsedThreads
          ? ["latest", "focused", "focused"]
          : ["latest", "latest"],
      );
      thread?.close();
    },
  };
}
