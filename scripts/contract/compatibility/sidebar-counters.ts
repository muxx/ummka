import assert from "node:assert/strict";
import {
  ChannelsApi,
  type Configuration,
} from "../../../vendor/mattermost/index.js";

export async function checkSidebarCounters(
  session: Configuration,
  teamId: string,
  channelId: string,
  username: string,
  post: (
    text: string,
    rootId?: string,
  ) => Promise<{ id: string; create_at: number }>,
  viewChannel: () => Promise<Response>,
) {
  const api = new ChannelsApi(session);
  const scope = { userId: "me", teamId };
  async function counts() {
    const [channels, members] = await Promise.all([
      api.getChannelsForTeamForUser(scope),
      api.getChannelMembersForUser(scope),
    ]);
    const channel = channels.find((c) => c.id === channelId);
    const member = members.find((m) => m.channelId === channelId);
    assert.ok(channel && member);
    const {
      totalMsgCount: total,
      totalMsgCountRoot: roots,
      lastPostAt: last,
      lastRootPostAt: lastRoot,
    } = channel;
    const {
      msgCount: seen,
      msgCountRoot: seenRoots,
      mentionCount: mentions,
      mentionCountRoot: rootMentions,
      urgentMentionCount: urgent,
    } = member;
    assert.ok(
      total !== undefined &&
        roots !== undefined &&
        last !== undefined &&
        lastRoot !== undefined,
    );
    assert.ok(
      seen !== undefined &&
        seenRoots !== undefined &&
        mentions !== undefined &&
        rootMentions !== undefined &&
        urgent !== undefined,
    );
    return {
      total,
      roots,
      last,
      lastRoot,
      seen,
      seenRoots,
      mentions,
      rootMentions,
      urgent,
    };
  }
  const baseline = await counts();
  const root = await post(`Root mention @${username}`);
  const withRoot = await counts();
  assert.deepEqual(withRoot, {
    ...baseline,
    total: baseline.total + 1,
    roots: baseline.roots + 1,
    last: root.create_at,
    lastRoot: root.create_at,
    mentions: baseline.mentions + 1,
    rootMentions: baseline.rootMentions + 1,
  });
  const reply = await post(`Reply mention @${username}`, root.id);
  const withReply = await counts();
  assert.deepEqual(withReply, {
    ...withRoot,
    total: withRoot.total + 1,
    last: reply.create_at,
    mentions: withRoot.mentions + 1,
  });
  await viewChannel();
  const viewed = await counts();
  assert.deepEqual(viewed, {
    ...withReply,
    seen: withReply.total,
    seenRoots: withReply.roots,
    mentions: 0,
    rootMentions: 0,
    urgent: 0,
  });
}
