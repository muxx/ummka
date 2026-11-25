import { expect, test } from "vitest";
import { latestReactionTarget } from "./latest-reaction-target.ts";

const channelId = "c".repeat(26);
const rootId = "r".repeat(26);
function post(letter: string, rootId: string | null = null, type = "") {
  return { id: letter.repeat(26), channelId, rootId, type };
}
const root = post("r");
const reply = post("b", rootId);
const sibling = post("s", "d".repeat(26));
test("uses server order, also for equal timestamps and expanded replies", () => {
  expect(latestReactionTarget(channelId, [reply, root])).toBe(reply.id);
  expect(latestReactionTarget(channelId, [root, reply])).toBe(root.id);
});
test("accepts custom and emote posts while skipping system and ephemeral records", () => {
  const ordinary = post("m", null, "me");
  const webhook = post("w", null, "custom_webhook");
  const excluded = [
    "system_header_change",
    "system_ephemeral",
    "system_ephemeral_add_to_channel",
  ].map((type, index) => post(String(index), null, type));
  expect(
    latestReactionTarget(channelId, [...excluded, webhook, ordinary]),
  ).toBe(webhook.id);
  expect(latestReactionTarget(channelId, [...excluded, ordinary])).toBe(
    ordinary.id,
  );
  expect(latestReactionTarget(channelId, excluded)).toBeNull();
  expect(latestReactionTarget(channelId, [])).toBeNull();
});
test("uses the first reply in this thread, even when the root occurs first", () => {
  const newest = post("n", rootId);
  const system = post("e", rootId, "system_ephemeral");
  expect(
    latestReactionTarget(
      channelId,
      [root, sibling, system, newest, reply],
      rootId,
    ),
  ).toBe(newest.id);
  expect(latestReactionTarget(channelId, [sibling, system, root], rootId)).toBe(
    root.id,
  );
  expect(latestReactionTarget(channelId, [sibling, reply], rootId)).toBe(
    reply.id,
  );
  expect(latestReactionTarget(channelId, [sibling], rootId)).toBeNull();
  expect(
    latestReactionTarget(
      channelId,
      [post("r", null, "system_generic")],
      rootId,
    ),
  ).toBeNull();
});
test("excludes rows from other channels and never changes the given order", () => {
  const others = [
    { ...reply, channelId: "d".repeat(26) },
    { ...root, channelId: "d".repeat(26) },
  ];
  const rows = Object.freeze([...others, root]);
  expect(latestReactionTarget(channelId, rows)).toBe(root.id);
  expect(latestReactionTarget(channelId, rows, rootId)).toBe(root.id);
  expect(latestReactionTarget(channelId, others, rootId)).toBeNull();
  expect(rows[0]).toBe(others[0]);
});
