import { expect, test } from "vitest";
import type { Post, PostList } from "../../vendor/mattermost/index.js";
import { assembleFocusedHistory } from "./focused-history.ts";

const channelId = "c".repeat(26);
const anchorId = "a".repeat(26);
const newer = "n".repeat(26);
const older = "o".repeat(26);
const reply = "r".repeat(26);
const otherReply = "t".repeat(26);
const scope = { channelId, collapsedThreads: false, anchorId };

function post(id: string, fields: Post = {}): Post {
  return {
    id,
    channelId,
    userId: "u".repeat(26),
    rootId: "",
    createAt: 100,
    updateAt: 100,
    editAt: 0,
    deleteAt: 0,
    message: id,
    type: "",
    hashtags: "",
    isPinned: false,
    ...fields,
  };
}

function page(...ids: string[]): PostList {
  return {
    order: ids,
    posts: Object.fromEntries(ids.map((id) => [id, post(id)])),
  };
}

test("keeps visible order, outward cursors and thread-only replies", () => {
  const after = {
    ...page(newer, reply),
    nextPostId: "x".repeat(26),
    prevPostId: anchorId,
    firstInaccessiblePostTime: 6,
  };
  const thread = {
    order: [anchorId, reply, otherReply],
    posts: {
      [anchorId]: post(anchorId),
      [reply]: post(reply, { message: "from thread", rootId: anchorId }),
      [otherReply]: post(otherReply, { rootId: anchorId }),
      [older]: post(older, { message: "from thread" }),
    },
    hasNext: true,
    firstInaccessiblePostTime: 3,
  };
  const before = {
    ...page(older),
    nextPostId: anchorId,
    prevPostId: "",
    firstInaccessiblePostTime: 9,
  };
  const parts = { ...scope, after, thread, before };
  const original = structuredClone(parts);
  const result = assembleFocusedHistory(parts);
  expect(result).toMatchObject({
    channelId,
    collapsedThreads: false,
    source: { kind: "focused", postId: anchorId },
    order: [newer, reply, anchorId, older],
    nextPostId: after.nextPostId,
    prevPostId: "",
    firstInaccessiblePostTime: 9,
  });
  expect(result.changes).toMatchObject([
    { id: newer },
    { id: reply, message: "from thread", rootId: anchorId },
    { id: anchorId },
    { id: otherReply, rootId: anchorId },
    { id: older, message: older },
  ]);
  expect(parts).toEqual(original);
});

test("an empty channel side contributes no rows or thread-only replies", () => {
  const result = assembleFocusedHistory({
    ...scope,
    anchorId: reply,
    after: { ...page(), nextPostId: "" },
    thread: page(anchorId, reply),
    before: { ...page(), prevPostId: older },
  });
  expect(result.order).toEqual([reply]);
  expect(result.changes.map(({ id }) => id)).toEqual([anchorId, reply]);
  expect(result.nextPostId).toBe("");
  expect(result.prevPostId).toBe(older);
  expect(result.firstInaccessiblePostTime).toBe(0);
});

test("an archived focus returns only the boundary reported for the thread", () => {
  expect(
    assembleFocusedHistory({
      ...scope,
      before: { ...page(older), firstInaccessiblePostTime: 100 },
      thread: { ...page(), firstInaccessiblePostTime: 80 },
      after: page(newer),
    }),
  ).toEqual({
    channelId,
    collapsedThreads: false,
    source: { kind: "focused", postId: anchorId },
    order: [],
    changes: [],
    nextPostId: "",
    prevPostId: "",
    firstInaccessiblePostTime: 80,
  });
});

test.each([
  page(),
  { order: [anchorId], posts: {}, firstInaccessiblePostTime: 80 },
  { order: [], posts: Object.create({ [anchorId]: { id: anchorId } }) },
  { posts: {}, firstInaccessiblePostTime: 80 },
])("a missing anchor record is a data error", (thread) => {
  expect(() =>
    assembleFocusedHistory({
      ...scope,
      before: page(older),
      thread,
      after: page(),
    }),
  ).toThrow("The focused post is missing");
});

test("a missing order or dictionary is distinct from an empty channel page", () => {
  expect(() =>
    assembleFocusedHistory({
      ...scope,
      after: { posts: {} },
      thread: page(anchorId),
      before: page(),
    }),
  ).toThrow("A channel page is missing");
});
