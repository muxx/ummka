import { describe, expect, it } from "vitest";
import expected from "../../contracts/mattermost/fixtures/channel-post-changes.json";
import windowPage from "../../contracts/mattermost/fixtures/channel-window-page.json";
import { PostListFromJSON } from "../../vendor/mattermost/index.js";
import { channelHistoryPage } from "./channel-history-page.ts";
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
  props: { from_webhook: "true", override_username: "fixture", data: {} },
};
function changes(posts: object) {
  return channelPostChanges(
    channel,
    PostListFromJSON({ order: [root], posts }),
  );
}

describe("channel post records", () => {
  it("projects thread replies outside the order and strips all content on deletion", () => {
    const dictionary = {
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
        props: undefined,
      },
      [removed]: { ...post, id: removed, delete_at: 123 },
    };
    expect(changes(dictionary)).toEqual(expected);
    const before = "e".repeat(26);
    expect(
      channelHistoryPage(
        { channelId: channel, collapsedThreads: true, before },
        PostListFromJSON({
          order: [root],
          posts: dictionary,
          prev_post_id: "",
          next_post_id: before,
          first_inaccessible_post_time: 0,
        }),
      ),
    ).toEqual({ ...windowPage, changes: expected });
    expect(changes({})).toEqual([]);
    expect(() => channelPostChanges(channel, {})).toThrow(TypeError);
  });
  it.each([
    [undefined, false],
    [null, false],
    [{}, false],
    [{ other: "value" }, false],
    [{ from_webhook: null }, false],
    [{ from_webhook: "true" }, true],
    [{ from_webhook: "false" }, undefined],
    [{ from_webhook: "True" }, undefined],
    [{ from_webhook: "" }, undefined],
    [{ from_webhook: true }, undefined],
    [{ from_webhook: false }, undefined],
    [{ from_webhook: 0 }, undefined],
    [{ from_webhook: 1 }, undefined],
    [{ from_webhook: {} }, undefined],
    [{ from_webhook: [] }, undefined],
    [[], undefined],
    ["malformed", undefined],
  ])("observes only the canonical webhook marker in %j", (props, observed) => {
    const [change] = changes({ [root]: { ...post, props } });
    expect(change).toMatchObject({ kind: "save", id: root });
    expect(change).not.toHaveProperty("props");
    if (observed === undefined)
      expect(change).not.toHaveProperty("fromWebhook");
    else expect(change).toHaveProperty("fromWebhook", observed);
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
