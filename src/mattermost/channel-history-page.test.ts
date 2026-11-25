import { expect, it } from "vitest";
import { PostListFromJSON } from "../../vendor/mattermost/index.js";
import { channelHistoryPage } from "./channel-history-page.ts";

const channelId = "c".repeat(26);
const a = "a".repeat(26);
const b = "b".repeat(26);
const anchor = "d".repeat(26);
const read = { channelId, collapsedThreads: true };
function record(id: string) {
  return {
    id,
    channel_id: channelId,
    root_id: "",
    user_id: "u".repeat(26),
    create_at: 100,
    update_at: 100,
    edit_at: 0,
    delete_at: 0,
    type: "",
    message: "Text",
    hashtags: "",
    is_pinned: false,
  };
}
function response(order: string[]) {
  return PostListFromJSON({
    order,
    posts: { [a]: record(a), [b]: record(b), [anchor]: record(anchor) },
    prev_post_id: a,
    next_post_id: "",
    first_inaccessible_post_time: 0,
  });
}

it("keeps the server's visible order at equal timestamps, separately from the dictionary", () => {
  for (const ids of [
    [a, b],
    [b, a],
  ]) {
    const expected = [...ids];
    const input = response(ids);
    const view = channelHistoryPage({ ...read, after: anchor }, input);
    expect(view.source).toEqual({ kind: "after", postId: anchor });
    expect(view.order).toEqual(expected);
    expect(view.changes).toHaveLength(3);
    expect(view.prevPostId).toBe(a);
    expect(view.nextPostId).toBe("");
    input.order?.reverse();
    expect(view.order).toEqual(expected);
  }
});

it("identifies sparse updates even when their order contains a deletion", () => {
  const page = response([b, a]);
  if (!page.posts) throw Error("Missing fixture");
  page.posts[a].deleteAt = 200;
  const view = channelHistoryPage(
    { channelId, since: 123, after: anchor },
    page,
  );
  expect(view.collapsedThreads).toBe(false);
  expect(view.source).toEqual({ kind: "since", since: 123 });
  expect(view.order).toEqual([b, a]);
  expect(view.changes).toContainEqual({ kind: "remove", id: a, channelId });
});

it("retains the direction of empty pages and the access boundary for a focused post", () => {
  const empty = { posts: {}, order: [] };
  expect(channelHistoryPage({ ...read, before: anchor }, empty).source).toEqual(
    { kind: "before", postId: anchor },
  );
  expect(channelHistoryPage({ ...read, since: 0 }, empty).source).toEqual({
    kind: "latest",
  });
  const focus = { ...read, focusedPostId: anchor };
  expect(channelHistoryPage(focus, response([a, anchor, b])).source).toEqual({
    kind: "focused",
    postId: anchor,
  });
  expect(
    channelHistoryPage(focus, { ...empty, firstInaccessiblePostTime: 78 })
      .firstInaccessiblePostTime,
  ).toBe(78);
  expect(() => channelHistoryPage(focus, empty)).toThrow(TypeError);
});

it("rejects missing records, foreign channels, and responses which cannot describe these windows", () => {
  expect(() => channelHistoryPage(read, response(["x".repeat(26)]))).toThrow(
    TypeError,
  );
  expect(() => channelHistoryPage({ channelId: b }, response([a]))).toThrow(
    TypeError,
  );
  expect(() => channelHistoryPage({ ...read, page: 1 }, response([a]))).toThrow(
    RangeError,
  );
  expect(() =>
    channelHistoryPage({ ...read, includeDeleted: true }, response([a])),
  ).toThrow(TypeError);
  expect(() =>
    channelHistoryPage(read, { ...response([a]), nextPostId: "bad" }),
  ).toThrow(TypeError);
});

it("keeps collapsed root counters and participant IDs without copying account or profile data", () => {
  const input = PostListFromJSON({
    order: [a, b],
    posts: {
      [a]: {
        ...record(a),
        reply_count: 2,
        last_reply_at: 250,
        is_following: true,
        participants: [
          { id: b, email: "example@example.test" },
          { id: anchor },
        ],
      },
      [b]: { ...record(b), root_id: a, reply_count: 2, last_reply_at: 250 },
    },
  });
  const [root, reply] = channelHistoryPage(read, input).changes;
  expect(root).toHaveProperty("threadSummary", {
    replyCount: 2,
    lastReplyAt: 250,
    participantIds: [b, anchor],
  });
  expect(reply).not.toHaveProperty("threadSummary");
  expect(
    channelHistoryPage({ ...read, collapsedThreads: false }, input).changes[0],
  ).not.toHaveProperty("threadSummary");
});

it("distinguishes missing measurements from an empty thread or unavailable participant list", () => {
  const projected = (fields: Record<string, unknown>) =>
    channelHistoryPage(
      read,
      PostListFromJSON({
        order: [a],
        posts: { [a]: { ...record(a), ...fields } },
      }),
    ).changes[0];
  expect(
    projected({ reply_count: 0, last_reply_at: 0, participants: null }),
  ).toHaveProperty("threadSummary", {
    replyCount: 0,
    lastReplyAt: 0,
    participantIds: null,
  });
  expect(
    projected({ reply_count: 1, last_reply_at: 100, participants: [] }),
  ).toHaveProperty("threadSummary.participantIds", []);
  for (const fields of [{ reply_count: 0 }, { last_reply_at: 0 }, {}])
    expect(projected(fields)).not.toHaveProperty("threadSummary");
  expect(
    projected({ delete_at: 110, reply_count: 1, last_reply_at: 100 }),
  ).not.toHaveProperty("threadSummary");
  for (const fields of [
    { reply_count: -1, last_reply_at: 2 },
    { reply_count: 1, last_reply_at: 1.5 },
    { reply_count: 1, last_reply_at: 2, participants: [{ id: "bad" }] },
  ])
    expect(() => projected(fields)).toThrow(TypeError);
});
