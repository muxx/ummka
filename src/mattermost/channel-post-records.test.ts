import { describe, expect, it } from "vitest";
import expected from "../../contracts/mattermost/fixtures/channel-post-changes.json";
import windowPage from "../../contracts/mattermost/fixtures/channel-window-page.json";
import { PostListFromJSON } from "../../vendor/mattermost/index.js";
import { channelHistoryPage } from "./channel-history-page.ts";
import {
  channelPostChange,
  channelPostChanges,
} from "./channel-post-records.ts";

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
  props: {
    from_webhook: "true",
    ai_generated_by: "b".repeat(26),
    ai_generated_by_username: "fixture-ai",
    override_username: "fixture",
    data: {},
  },
  metadata: { priority: { priority: "important" } },
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
        props: { attachments: [{ title: "Release reply", text: "**Ready**" }] },
        metadata: { embeds: [{ type: "message_attachment" }] },
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
  it("distinguishes a full root outside order from a partial read of the same post", () => {
    const wire = {
      ...post,
      message: "",
      props: { attachments: [{ title: "Release candidate" }] },
      metadata: { embeds: [{ type: "message_attachment" }] },
    };
    const page = PostListFromJSON({ order: [reply], posts: { [root]: wire } });
    expect(channelPostChanges(channel, page)[0]).toMatchObject({
      kind: "save",
      cards: [{ title: "Release candidate" }],
    });
    expect(
      channelPostChange(
        channel,
        root,
        { ...page.posts?.[root], metadata: {} },
        { embeds: "partial" },
      ),
    ).not.toHaveProperty("cards");
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
  it.each([
    [undefined, "standard", undefined],
    [{ priority: { priority: "" } }, "standard", "standard"],
    [{ priority: { priority: "important" } }, "important", "important"],
    [
      { priority: { priority: "urgent", requested_ack: true } },
      "urgent",
      "urgent",
    ],
    [{ priority: { priority: "experimental" } }, "other", "other"],
    [{ priority: { priority: "standard" } }, "other", "other"],
    [{ priority: { requested_ack: true } }, "standard", undefined],
    [{ priority: { priority: true } }, undefined, undefined],
  ])(
    "observes display priority in complete and extra records (%j)",
    (metadata, full, partial) => {
      const wire = PostListFromJSON({
        order: [root],
        posts: {
          [root]: { ...post, metadata },
          [reply]: { ...post, id: reply, metadata },
        },
      });
      const [ordered, extra] = channelPostChanges(channel, wire);
      expect(ordered).toMatchObject({ kind: "save", id: root });
      expect(extra).toMatchObject({ kind: "save", id: reply });
      for (const [row, observed] of [
        [ordered, full],
        [extra, partial],
      ] as const) {
        if (observed === undefined)
          expect(row).not.toHaveProperty("displayPriority");
        else expect(row).toHaveProperty("displayPriority", observed);
      }
    },
  );
  it.each([
    [undefined, { kind: "none" }],
    [{ other: "data" }, { kind: "none" }],
    [
      { ai_generated_by: post.props.ai_generated_by },
      {
        kind: "source",
        userId: post.props.ai_generated_by,
        hasUsername: false,
      },
    ],
    [
      {
        ai_generated_by: post.props.ai_generated_by,
        ai_generated_by_username: "",
      },
      {
        kind: "source",
        userId: post.props.ai_generated_by,
        hasUsername: false,
      },
    ],
    [
      post.props,
      { kind: "source", userId: post.props.ai_generated_by, hasUsername: true },
    ],
    [{ ai_generated_by_username: "unmatched" }, undefined],
    [
      {
        ai_generated_by: post.props.ai_generated_by,
        ai_generated_by_username: false,
      },
      undefined,
    ],
    [
      { ai_generated_by: "bad-id", ai_generated_by_username: "mismatch" },
      undefined,
    ],
    [{ ai_generated_by: null }, undefined],
    ["malformed", undefined],
  ])(
    "keeps only the display shape of AI attribution (%j)",
    (props, observed) => {
      const wire = PostListFromJSON({
        order: [root],
        posts: { [root]: { ...post, props } },
      });
      const change = channelPostChange(channel, root, wire.posts?.[root] ?? {});
      if (observed === undefined)
        expect(change).not.toHaveProperty("aiAttribution");
      else expect(change).toHaveProperty("aiAttribution", observed);
      expect(change).not.toHaveProperty("props");
      expect(JSON.stringify(change)).not.toContain("fixture-ai");
    },
  );
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
