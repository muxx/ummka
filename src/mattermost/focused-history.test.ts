import { expect, test } from "vitest";
import type { PostList } from "../../vendor/mattermost/index.js";
import { assembleFocusedHistory } from "./focused-history.ts";

function page(...ids: string[]): PostList {
  return {
    order: ids,
    posts: Object.fromEntries(ids.map((id) => [id, { id }])),
  };
}

test("channel order, duplicate posts and outward cursors follow the WebApp", () => {
  const after = {
    ...page("newer", "reply"),
    nextPostId: "newest-cursor",
    prevPostId: "inner-cursor",
    firstInaccessiblePostTime: 6,
  };
  const thread = {
    order: ["anchor", "reply", "other-reply"],
    posts: {
      anchor: { id: "anchor" },
      reply: { id: "reply", message: "from thread" },
      "other-reply": { id: "other-reply", rootId: "anchor" },
      older: { id: "older", message: "from thread" },
    },
    hasNext: true,
    firstInaccessiblePostTime: 3,
  };
  const before = {
    ...page("older"),
    nextPostId: "inner-cursor",
    prevPostId: "",
    firstInaccessiblePostTime: 9,
  };
  const parts = { anchorId: "anchor", after, thread, before };
  const original = structuredClone(parts);
  const result = assembleFocusedHistory(parts);
  expect(result).toEqual({
    order: ["newer", "reply", "anchor", "older"],
    posts: {
      ...after.posts,
      anchor: { id: "anchor" },
      reply: { id: "reply", message: "from thread" },
      "other-reply": { id: "other-reply", rootId: "anchor" },
      older: { id: "older" },
    },
    nextPostId: "newest-cursor",
    prevPostId: "",
    firstInaccessiblePostTime: 9,
  });
  expect(parts).toEqual(original);
});

test("an empty channel side contributes no rows or thread-only replies", () => {
  const thread = page("root", "reply");
  const result = assembleFocusedHistory({
    anchorId: "reply",
    after: { ...page(), nextPostId: "" },
    thread,
    before: { ...page(), prevPostId: "older-cursor" },
  });
  expect(result.order).toEqual(["reply"]);
  expect(result.posts).toEqual(thread.posts);
  expect(result.posts).not.toBe(thread.posts);
  expect(result.nextPostId).toBe("");
  expect(result.prevPostId).toBe("older-cursor");
  expect(result.firstInaccessiblePostTime).toBe(0);
});

test("an archived focus returns only the boundary reported for the thread", () => {
  expect(
    assembleFocusedHistory({
      anchorId: "archived",
      before: { ...page("old"), firstInaccessiblePostTime: 100 },
      thread: { ...page(), firstInaccessiblePostTime: 80 },
      after: page("new"),
    }),
  ).toEqual({
    order: [],
    posts: {},
    nextPostId: "",
    prevPostId: "",
    firstInaccessiblePostTime: 80,
  });
});

test.each([
  page(),
  { order: ["missing"], posts: {}, firstInaccessiblePostTime: 80 },
  { order: [], posts: Object.create({ missing: { id: "missing" } }) },
  { posts: {}, firstInaccessiblePostTime: 80 },
])("a missing anchor record is a data error", (thread) => {
  expect(() =>
    assembleFocusedHistory({
      anchorId: "missing",
      before: page("missing"),
      thread,
      after: page(),
    }),
  ).toThrow("The focused post is missing");
});

test("a missing order or dictionary is distinct from an empty channel page", () => {
  expect(() =>
    assembleFocusedHistory({
      anchorId: "anchor",
      after: { posts: {} },
      thread: page("anchor"),
      before: page(),
    }),
  ).toThrow("A channel page is missing");
});
