import assert from "node:assert/strict";
import { loadTeamDirectory } from "../../../src/mattermost/navigation-data.ts";
import { projectTeamSidebar } from "../../../src/mattermost/team-sidebar.ts";
import type { Configuration } from "../../../vendor/mattermost/index.js";

export async function checkSidebarCounters(
  session: Configuration,
  userId: string,
  teamId: string,
  channelId: string,
  username: string,
  post: (
    text: string,
    rootId?: string,
  ) => Promise<{ id: string; create_at: number }>,
  viewChannel: () => Promise<Response>,
) {
  async function counts() {
    const directory = await loadTeamDirectory(session, userId, teamId);
    const row = projectTeamSidebar(directory).channels.find(
      (item) => item.id === channelId,
    );
    assert.ok(row);
    const {
      totalMsgCount: total,
      totalMsgCountRoot: roots,
      lastPostAt: last,
      lastRootPostAt: lastRoot,
    } = row;
    const {
      msgCount: seen,
      msgCountRoot: seenRoots,
      mentionCount: mentions,
      mentionCountRoot: rootMentions,
      urgentMentionCount: urgent,
    } = row;
    assert.ok(
      total !== null && roots !== null && last !== null && lastRoot !== null,
    );
    assert.ok(
      seen !== null &&
        seenRoots !== null &&
        mentions !== null &&
        rootMentions !== null &&
        urgent !== null,
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
