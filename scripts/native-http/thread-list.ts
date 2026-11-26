import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { text } from "node:stream/consumers";

export async function respondToThreadList(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  teamId: string,
  channelId: string,
  userId: string,
) {
  if (url.pathname !== `/team/chat/api/v4/users/me/teams/${teamId}/threads`)
    return;
  assert.equal(request.method, "GET");
  assert.equal(
    request.headers.authorization,
    "Bearer fixture-prefixed-session",
  );
  assert.equal(request.headers.cookie, undefined);
  assert.equal(await text(request), "");
  const query = Object.fromEntries(url.searchParams);
  assert.equal(url.searchParams.size, Object.keys(query).length);
  const counters = {
    total: 7,
    total_unread_threads: 3,
    total_unread_mentions: 5,
    total_unread_urgent_mentions: 2,
  };
  const noCounts = {
    total: 0,
    total_unread_threads: 0,
    total_unread_mentions: 0,
    total_unread_urgent_mentions: 0,
  };
  const reply = (body: object, label: string) => {
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(body));
    return label;
  };
  if (query.totalsOnly) {
    if (query.excludeDirect === undefined) {
      assert.deepEqual(query, { totalsOnly: "true" });
      return reply({ ...counters, threads: null }, "account-thread-totals");
    }
    assert.deepEqual(query, { totalsOnly: "true", excludeDirect: "true" });
    return reply({ ...counters, threads: null }, "thread-list-totals");
  }
  if (query.after) {
    assert.deepEqual(query, {
      after: "p".repeat(26),
      threadsOnly: "true",
      per_page: "25",
    });
    return reply(
      {
        total: 0,
        total_unread_threads: 0,
        total_unread_mentions: 0,
        total_unread_urgent_mentions: 0,
        threads: [],
      },
      "thread-list-empty",
    );
  }
  const accountPage = query.threadsOnly === "true";
  if (accountPage && query.before) {
    assert.deepEqual(query, {
      before: "p".repeat(26),
      per_page: "1",
      threadsOnly: "true",
      extended: "true",
      unread: "true",
    });
    return reply({ ...noCounts, threads: [] }, "account-thread-empty");
  }
  if (accountPage) {
    assert.deepEqual(query, {
      per_page: "1",
      threadsOnly: "true",
      extended: "true",
      unread: "true",
    });
  } else {
    assert.deepEqual(query, {
      before: "n".repeat(26),
      extended: "true",
      unread: "true",
      per_page: "25",
      excludeDirect: "false",
    });
  }
  const postId = "p".repeat(26);
  return reply(
    {
      ...(accountPage ? noCounts : counters),
      threads: [
        {
          id: postId,
          reply_count: 9,
          last_reply_at: 740,
          last_viewed_at: 500,
          delete_at: 0,
          unread_replies: 4,
          unread_mentions: 2,
          is_urgent: true,
          participants: [{ id: userId, username: "fixture-participant" }],
          post: {
            id: postId,
            user_id: userId,
            channel_id: channelId,
            message: "Thread list fixture",
            create_at: 70,
            update_at: 70,
            edit_at: 0,
            delete_at: 0,
            root_id: "",
            type: "",
            hashtags: "",
            is_pinned: false,
          },
        },
      ],
    },
    accountPage ? "account-thread-page" : "thread-list-page",
  );
}
