import {
  type Configuration,
  ThreadsApi,
  type UserThread,
} from "../../vendor/mattermost/index.js";
import { channelPostChange } from "./channel-post-records.ts";
import type { LocalPost } from "./local-history.ts";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

import { setThreadFollowing, type ThreadPost } from "./thread-following.ts";

type PageQuery = {
  teamId: string;
  unread: boolean;
  before?: string;
  perPage?: number;
};

function scope(teamId: string) {
  if (!isMattermostId(teamId))
    throw new TypeError("Invalid Mattermost thread list team.");
  return { userId: "me", teamId };
}

function visibleRoot(row: UserThread, id: string): LocalPost | null {
  const { post } = row;
  if (!post || row.deleteAt !== 0) return null;
  if (!isMattermostId(post.channelId))
    throw new TypeError("Invalid Mattermost thread root channel.");
  const projected = channelPostChange(post.channelId, id, post, {
    priority: "partial",
    embeds: "partial",
  });
  if (projected.kind === "remove") return null;
  if (projected.rootId !== null)
    throw new TypeError("Expected a root post in the Mattermost thread list.");
  const { kind: _kind, ...root } = projected;
  return root;
}

function threadReadState(row: UserThread) {
  if (
    !row ||
    !isMattermostId(row.id) ||
    !isMattermostTime(row.lastViewedAt, 0) ||
    !isMattermostTime(row.unreadReplies, 0) ||
    !isMattermostTime(row.unreadMentions, 0)
  )
    throw new TypeError("Invalid Mattermost thread read state.");
  return {
    id: row.id,
    lastViewedAt: row.lastViewedAt,
    unreadReplies: row.unreadReplies,
    unreadMentions: row.unreadMentions,
  };
}

function threadRow(row: UserThread) {
  const read = threadReadState(row);
  if (
    !isMattermostTime(row.deleteAt, 0) ||
    !isMattermostTime(row.replyCount, 0) ||
    !isMattermostTime(row.lastReplyAt, 0) ||
    typeof row.isUrgent !== "boolean" ||
    !Array.isArray(row.participants)
  )
    throw new TypeError("Invalid Mattermost followed thread.");
  return {
    ...read,
    post: visibleRoot(row, read.id),
    participantIds: row.participants.map((participant) => {
      if (!isMattermostId(participant?.id))
        throw new TypeError("Invalid Mattermost thread participant.");
      return participant.id;
    }),
    replyCount: row.replyCount,
    lastReplyAt: row.lastReplyAt,
    isUrgent: row.isUrgent,
  };
}

export function accountFollowedThreads(
  config: Configuration,
  whileOpen: <T>(read: () => Promise<T>, signal?: AbortSignal) => Promise<T>,
) {
  const api = new ThreadsApi(config);
  return {
    setThreadFollowing(
      teamId: string,
      post: ThreadPost,
      following: boolean,
      signal?: AbortSignal,
    ) {
      return whileOpen(
        () => setThreadFollowing(api, teamId, post, following, signal),
        signal,
      );
    },
    markFollowedThreadRead(
      teamId: string,
      threadId: string,
      timestamp: number,
      signal?: AbortSignal,
    ) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        if (!isMattermostId(threadId) || !isMattermostTime(timestamp, 1))
          throw new TypeError("Invalid Mattermost thread read target.");
        const response = await api.updateThreadReadForUserRaw(
          { ...scope(teamId), threadId, timestamp },
          { signal },
        );
        const result = threadReadState(await response.value());
        signal?.throwIfAborted();
        if (
          response.raw.status !== 200 ||
          result.id !== threadId ||
          result.lastViewedAt !== timestamp
        )
          throw new TypeError(
            "Mattermost did not confirm the requested thread read state.",
          );
        return result;
      }, signal);
    },
    markTeamThreadsRead(teamId: string, signal?: AbortSignal) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        const response = await api.updateThreadsReadForUserRaw(scope(teamId), {
          signal,
        });
        const result = await response.value();
        signal?.throwIfAborted();
        if (response.raw.status !== 200 || result?.status !== "OK")
          throw new TypeError(
            "Mattermost did not confirm team thread read state.",
          );
      }, signal);
    },
    readFollowedThreads(query: PageQuery, signal?: AbortSignal) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        const { teamId, unread, before, perPage = 25 } = query;
        if (
          typeof unread !== "boolean" ||
          (before !== undefined && !isMattermostId(before))
        )
          throw new TypeError(
            "Invalid Mattermost thread list filter or cursor.",
          );
        if (!Number.isInteger(perPage) || perPage < 1 || perPage > 200)
          throw new RangeError(
            "Expected a Mattermost thread page size between 1 and 200.",
          );
        const result = await api.getUserThreads(
          {
            ...scope(teamId),
            unread,
            before,
            perPage,
            extended: true,
            threadsOnly: true,
          },
          { signal },
        );
        signal?.throwIfAborted();
        if (!Array.isArray(result?.threads) || result.threads.length > perPage)
          throw new TypeError("Invalid Mattermost followed thread page.");
        const seen = new Set<string>();
        if (before) seen.add(before);
        let previous = Infinity;
        const items = result.threads.map((raw) => {
          const item = threadRow(raw);
          if (seen.has(item.id) || item.lastReplyAt > previous)
            throw new TypeError(
              "Invalid Mattermost thread page order or repeated root.",
            );
          previous = item.lastReplyAt;
          seen.add(item.id);
          return item;
        });
        return {
          items,
          nextBefore:
            items.length === perPage ? items[items.length - 1].id : null,
        };
      }, signal);
    },
    readFollowedThreadTotals(teamId: string, signal?: AbortSignal) {
      return whileOpen(async () => {
        signal?.throwIfAborted();
        const result = await api.getUserThreads(
          { ...scope(teamId), totalsOnly: true },
          { signal },
        );
        signal?.throwIfAborted();
        if (
          result?.threads !== null ||
          !isMattermostTime(result.total, 0) ||
          !isMattermostTime(result.totalUnreadThreads, 0) ||
          !isMattermostTime(result.totalUnreadMentions, 0) ||
          !isMattermostTime(result.totalUnreadUrgentMentions, 0)
        )
          throw new TypeError("Invalid Mattermost followed thread totals.");
        return {
          total: result.total,
          totalUnreadThreads: result.totalUnreadThreads,
          totalUnreadMentions: result.totalUnreadMentions,
          totalUnreadUrgentMentions: result.totalUnreadUrgentMentions,
        };
      }, signal);
    },
  };
}
