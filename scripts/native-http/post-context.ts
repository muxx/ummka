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
  const fileId = "f".repeat(26);
  const fileInfo = `/api/v4/files/${fileId}/info`;
  const base = `/api/v4/posts/${post}`;
  const prefixed = url.pathname.startsWith("/team/chat/");
  const route = prefixed
    ? url.pathname.slice("/team/chat".length)
    : url.pathname;
  if (
    route !== fileInfo &&
    route !== `${base}/info` &&
    route !== `${base}/thread` &&
    !(route === base && request.method === "GET")
  )
    return;
  assert.equal(request.method, "GET");
  assert.equal(request.headers.cookie, undefined);
  assert.equal(
    request.headers.authorization,
    prefixed
      ? "Bearer fixture-prefixed-session"
      : "Bearer fixture-root-session",
  );
  if (route === fileInfo) {
    assert.equal(url.search, "");
    if (prefixed) {
      response.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          id: fileId,
          post_id: post,
          channel_id: channelId,
          name: "fixture.txt",
        }),
      );
      return "single-file-info";
    }
    response
      .writeHead(403, {
        "Content-Type": "application/json",
        "First-Inaccessible-File-Time": "1",
      })
      .end(
        JSON.stringify({
          id: "app.file.cloud.get.app_error",
          status_code: 403,
          message: "Outside accessible history",
        }),
      );
    return "single-file-retention";
  }
  if (route === base) {
    assert.equal(url.search, "");
    if (prefixed) {
      response.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          id: post,
          root_id: "r".repeat(26),
          channel_id: channelId,
          user_id: "u".repeat(26),
          create_at: 1100,
          update_at: 1250,
          edit_at: 1250,
          delete_at: 0,
          type: "",
          message: "Later reply",
          file_ids: [],
          metadata: { redacted_file_count: 2 },
          hashtags: "",
          is_pinned: true,
        }),
      );
      return "single-post-reply";
    }
    response
      .writeHead(403, {
        "Content-Type": "application/json",
        "First-Inaccessible-Post-Time": "1",
      })
      .end(
        JSON.stringify({
          id: "app.post.cloud.get.app_error",
          status_code: 403,
          message: "Outside accessible history",
        }),
      );
    return "single-post-retention";
  }
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
          order: [post],
          posts: {
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
