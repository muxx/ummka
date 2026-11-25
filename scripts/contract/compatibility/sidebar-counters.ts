import assert from "node:assert/strict";
import { loadTeamDirectory } from "../../../src/mattermost/navigation-data.ts";
import { projectTeamSidebar } from "../../../src/mattermost/team-sidebar.ts";
import {
  ChannelsApi,
  Configuration,
  PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

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
  otherChannelId: string,
  prepareBulkRead: () => Promise<unknown>,
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
  const api = new ChannelsApi(session);
  const single = {
    userId: "me",
    viewChannelRequest: { channelId, collapsedThreadsSupported: true },
  };
  const result = await api.viewChannel(single);
  assert.equal(result.status, "OK");
  const viewedTime = result.lastViewedAtTimes?.[channelId];
  assert.ok(
    typeof viewedTime === "number" &&
      Number.isSafeInteger(viewedTime) &&
      viewedTime > 0,
  );

  const viewed = await counts();
  assert.deepEqual(viewed, {
    ...withReply,
    seen: withReply.total,
    seenRoots: withReply.roots,
    mentions: 0,
    rootMentions: 0,
    urgent: 0,
  });
  const unread = await new PostsApi(session).setPostUnread({
    userId: "me",
    postId: root.id,
    setPostUnreadRequest: { collapsedThreadsSupported: true },
  });
  const marked = await counts();
  assert.equal(unread.teamId, teamId);
  assert.equal(unread.userId, userId);
  assert.equal(unread.channelId, channelId);
  assert.ok(
    typeof unread.lastViewedAt === "number" &&
      unread.lastViewedAt <= root.create_at,
  );
  assert.equal(unread.msgCount, marked.seen);
  assert.equal(unread.msgCountRoot, marked.seenRoots);
  assert.equal(unread.mentionCount, marked.mentions);
  assert.equal(unread.mentionCountRoot, marked.rootMentions);
  assert.equal(unread.urgentMentionCount, marked.urgent);
  assert.ok(marked.seen < marked.total && marked.rootMentions > 0);
  await prepareBulkRead();
  const batch = { userId: "me", requestBody: [channelId, otherChannelId] };
  const bulk = await api.markChannelsReadForUser(batch);
  assert.equal(bulk.status, "OK");
  for (const id of batch.requestBody) {
    const time = bulk.lastViewedAtTimes?.[id];
    assert.ok(
      typeof time === "number" && Number.isSafeInteger(time) && time > 0,
    );
  }
  const read = await counts();
  assert.equal(read.seen, read.total);
  await assert.rejects(
    api.markChannelsReadForUser({ ...batch, requestBody: [] }),
    (err: unknown) =>
      err instanceof ResponseError && err.response.status === 400,
  );
  const anonymous = new ChannelsApi(
    new Configuration({ basePath: session.basePath }),
  );
  await assert.rejects(
    anonymous.viewChannel(single),
    (err: unknown) =>
      err instanceof ResponseError && err.response.status === 401,
  );
}
