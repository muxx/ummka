import assert from "node:assert/strict";
import type {
  ChannelsApi,
  PostsApi,
} from "../../../vendor/mattermost/index.js";
import { mentionTextCases } from "./mention-text-cases.ts";

export async function checkMentionText(
  sender: PostsApi,
  reader: ChannelsApi,
  channelId: string,
  readerName: string,
) {
  const read = () => reader.getChannelMember({ channelId, userId: "me" });
  let before = await read();
  for (const [message, alertsReader] of mentionTextCases) {
    await sender.createPost({ createPostRequest: { channelId, message } });
    // A direct mention is a positive control even when the sample should notify nobody.
    await sender.createPost({
      createPostRequest: { channelId, message: `Control @${readerName}` },
    });
    const after = await read();
    assert.ok(
      typeof before.mentionCount === "number" &&
        typeof before.mentionCountRoot === "number",
    );
    const delta = alertsReader ? 2 : 1;
    assert.equal(after.mentionCount, before.mentionCount + delta, message);
    assert.equal(
      after.mentionCountRoot,
      before.mentionCountRoot + delta,
      message,
    );
    before = after;
  }
}
