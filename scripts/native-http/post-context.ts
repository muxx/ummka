import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export function respondToPostContext(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  channelId: string,
  teamId: string,
): string | undefined {
  const post = "p".repeat(26);
  const base = `/api/v4/posts/${post}`;
  const prefixed = url.pathname.startsWith("/team/chat/");
  const route = prefixed
    ? url.pathname.slice("/team/chat".length)
    : url.pathname;
  if (route !== `${base}/info` && route !== `${base}/thread`) return;
  assert.equal(request.method, "GET");
  assert.equal(request.headers.cookie, undefined);
  assert.equal(
    request.headers.authorization,
    prefixed
      ? "Bearer fixture-prefixed-session"
      : "Bearer fixture-root-session",
  );
  if (route === `${base}/thread`) {
    const root = "r".repeat(26);
    assert.deepEqual(
      [...url.searchParams].sort(),
      Object.entries(
        prefixed
          ? {
              perPage: "1",
              fromCreateAt: "1000",
              fromPost: root,
              direction: "up",
            }
          : {
              perPage: "60",
              direction: "down",
              skipFetchThreads: "false",
              collapsedThreads: "true",
              collapsedThreadsExtended: "true",
            },
      ).sort(),
    );
    const page = prefixed
      ? {
          order: [],
          posts: null,
          first_inaccessible_post_time: 1800,
        }
      : {
          order: [post, root],
          posts: {
            [root]: {
              id: root,
              root_id: "",
              channel_id: channelId,
              message: "Root",
            },
            [post]: {
              id: post,
              root_id: root,
              channel_id: channelId,
              message: "Reply",
            },
          },
          has_next: false,
          first_inaccessible_post_time: 0,
        };
    response.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        ...page,
        next_post_id: "",
        prev_post_id: "",
      }),
    );
    return prefixed ? "post-thread-archive" : "post-thread-reply";
  }
  assert.equal(url.search, "");
  response.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      channel_id: channelId,
      channel_type: prefixed ? "D" : "O",
      channel_display_name: prefixed ? "" : "Town Square",
      has_joined_channel: true,
      team_id: prefixed ? "" : teamId,
      team_type: prefixed ? "" : "O",
      team_display_name: prefixed ? "" : "Fixture",
      has_joined_team: !prefixed,
    }),
  );
  return prefixed ? "post-info-prefixed" : "post-info-root";
}
