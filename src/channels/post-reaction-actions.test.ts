import { expect, test } from "vitest";
import {
  postReactionBadges,
  postReactionDecision,
} from "./post-reaction-actions.ts";

const userId = "u".repeat(26);
const other = "v".repeat(26);
const postId = "p".repeat(26);
function row(userId: string, emojiName: string) {
  return { userId, emojiName, postId };
}
const access = {
  online: true,
  archived: false,
  add: "allowed",
  remove: "allowed",
  uniqueLimit: 2,
} as const;
const badges = postReactionBadges(postId, userId, [
  row(other, "thumbsup"),
  row(other, "eyes"),
  row(userId, "eyes"),
]);
test("indexes exact wire names, distinct badges and only the current user's participation", () => {
  const mixed = postReactionBadges(postId, userId, [
    row(other, "thumbsup"),
    row(userId, "+1"),
    row(other, "+1"),
    row(userId, "constructor"),
  ]);
  expect([...mixed]).toEqual([
    ["thumbsup", { count: 1, own: false }],
    ["+1", { count: 2, own: true }],
    ["constructor", { count: 1, own: true }],
  ]);
  expect(() =>
    postReactionBadges(postId, userId, [
      { ...row(other, "eyes"), postId: "q".repeat(26) },
    ]),
  ).toThrow(TypeError);
});
test("an explicit duplicate preserves the request, while clicking a badge toggles", () => {
  expect(postReactionDecision(badges, "eyes", "add", access)).toBe(
    "alreadyAdded",
  );
  expect(postReactionDecision(badges, "thumbsup", "remove", access)).toBe(
    "notAdded",
  );
  expect(postReactionDecision(badges, "thumbsup", "toggle", access)).toBe(
    "add",
  );
  expect(postReactionDecision(badges, "eyes", "toggle", access)).toBe("remove");
});
test("counts distinct wire names at or above the limit", () => {
  expect(postReactionDecision(badges, "+1", "add", access)).toBe(
    "limitReached",
  );
  expect(
    postReactionDecision(badges, "+1", "add", { ...access, uniqueLimit: 3 }),
  ).toBe("add");
  expect(
    postReactionDecision(badges, "thumbsup", "add", {
      ...access,
      uniqueLimit: 0,
    }),
  ).toBe("add");
  expect(
    postReactionDecision(new Map(), "+1", "add", { ...access, uniqueLimit: 0 }),
  ).toBe("limitReached");
  expect(
    postReactionDecision(badges, "eyes", "remove", {
      ...access,
      uniqueLimit: 0,
    }),
  ).toBe("remove");
});
test("joining or leaving a known name needs no limit value", () => {
  const unknown = { ...access, uniqueLimit: undefined };
  expect(postReactionDecision(badges, "wave", "add", unknown)).toBe(
    "limitUnknown",
  );
  expect(
    postReactionDecision(badges, "wave", "add", {
      ...access,
      uniqueLimit: NaN,
    }),
  ).toBe("limitUnknown");
  expect(postReactionDecision(badges, "thumbsup", "add", unknown)).toBe("add");
  expect(postReactionDecision(badges, "eyes", "remove", unknown)).toBe(
    "remove",
  );
});
test("uses the permission for the requested mutation", () => {
  expect(
    postReactionDecision(badges, "eyes", "toggle", {
      ...access,
      add: "denied",
    }),
  ).toBe("remove");
  expect(
    postReactionDecision(badges, "eyes", "toggle", {
      ...access,
      remove: "denied",
    }),
  ).toBe("permissionDenied");
  expect(
    postReactionDecision(badges, "thumbsup", "toggle", {
      ...access,
      add: "unknown",
    }),
  ).toBe("permissionUnknown");
  expect(
    postReactionDecision(badges, "thumbsup", "add", {
      ...access,
      add: "denied",
    }),
  ).toBe("permissionDenied");
  expect(
    postReactionDecision(badges, "eyes", "remove", {
      ...access,
      remove: "unknown",
    }),
  ).toBe("permissionUnknown");
});
test("preserves read-only counts when archived or disconnected", () => {
  for (const request of ["add", "remove", "toggle"] as const) {
    expect(
      postReactionDecision(badges, "eyes", request, {
        ...access,
        online: false,
      }),
    ).toBe("offline");
    expect(
      postReactionDecision(badges, "eyes", request, {
        ...access,
        archived: true,
      }),
    ).toBe("archived");
  }
  expect(
    postReactionDecision(badges, "eyes", "toggle", {
      ...access,
      online: false,
      archived: true,
    }),
  ).toBe("offline");
  expect(badges.get("eyes")).toEqual({ count: 2, own: true });
});
