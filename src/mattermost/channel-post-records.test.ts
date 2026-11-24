import { describe, expect, it } from "vitest";
import expected from "../../contracts/mattermost/fixtures/channel-post-changes.json";
import { PostListFromJSON } from "../../vendor/mattermost/index.js";
import { channelPostChanges } from "./channel-post-records.ts";

const channel = "c".repeat(26);
const root = "r".repeat(26);
const reply = "p".repeat(26);
const removed = "d".repeat(26);
const post = {
  id: root,
  channel_id: channel,
  user_id: "a".repeat(26),
  root_id: "",
  type: "",
  create_at: 100,
  update_at: 110,
  edit_at: 108,
  delete_at: 0,
  is_pinned: true,
  message: "![sky](https://chat.example.test/api/v4/image?url=sky)",
  message_source: "![sky](https://images.example.test/sky.png)",
  hashtags: "",
};
function changes(posts: object) {
  return channelPostChanges(
    channel,
    PostListFromJSON({ order: [root], posts }),
  );
}

describe("channel post records", () => {
  it("projects thread replies outside the order and strips all content on deletion", () => {
    expect(
      changes({
        [root]: post,
        [reply]: {
          ...post,
          id: reply,
          root_id: root,
          create_at: 101,
          update_at: 101,
          edit_at: 0,
          message: "Reply #sky",
          message_source: undefined,
          hashtags: "#sky",
          is_pinned: false,
        },
        [removed]: { ...post, id: removed, delete_at: 123 },
      }),
    ).toEqual(expected);
    expect(changes({})).toEqual([]);
    expect(() => channelPostChanges(channel, {})).toThrow(TypeError);
  });
  it("rejects the page when a dictionary key, channel or scalar field is invalid", () => {
    for (const broken of [
      { id: root },
      { channel_id: "x".repeat(26) },
      { root_id: reply },
      { user_id: "bad" },
      { delete_at: -1 },
      { update_at: 1.5 },
      { is_pinned: "true" },
      { message_source: 42 },
    ]) {
      expect(() =>
        changes({ [root]: post, [reply]: { ...post, id: reply, ...broken } }),
      ).toThrow(TypeError);
    }
  });
});
