import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

const team = "Team0123456789012345678901";
const town = "c".repeat(26);
const townRoot = "v".repeat(26);
const design = "d".repeat(26);
const member = "f".repeat(26);

const category = "k".repeat(26);

function latest(url: URL) {
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    page: "0",
    per_page: "60",
    skipFetchThreads: "false",
    collapsedThreads: "true",
    collapsedThreadsExtended: "false",
  });
  assert.equal(url.searchParams.size, 5);
}
function postList(channelId: string, userId: string, message: string) {
  const id = channelId === town ? townRoot : "y".repeat(26);
  return {
    order: [id],
    posts: {
      [id]: {
        id,
        channel_id: channelId,
        user_id: userId,
        create_at: 560,
        update_at: 560,
        edit_at: 0,
        delete_at: 0,
        root_id: "",
        message,
        type: "",
        hashtags: "",
        is_pinned: false,
      },
    },
    prev_post_id: "",
    next_post_id: "",
    first_inaccessible_post_time: 0,
  };
}

export async function respondToWorkspace(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  prefixedUser: string,
  restoredPosting: boolean,
): Promise<string | undefined> {
  function json(value: unknown, name: string, status = 200) {
    res
      .writeHead(status, { "Content-Type": "application/json" })
      .end(JSON.stringify(value));
    return name;
  }
  if (
    url.pathname === `/team/chat/api/v4/channels/${town}/posts` &&
    url.searchParams.get("per_page") === "60"
  ) {
    assert.equal(req.method, "GET");
    assert.equal(req.headers.authorization, "Bearer fixture-prefixed-session");
    assert.equal(req.headers.cookie, undefined);
    latest(url);
    return json(
      postList(town, prefixedUser, "Saved fixture room message"),
      "saved-room-history",
    );
  }
  const base = "/browser-action-check/api/v4/";
  if (!url.pathname.startsWith(base)) return;
  const path = url.pathname.slice(base.length);
  const routes = new Map<string, unknown>([
    [
      `users/me/teams/${team}/channels`,
      [
        {
          id: town,
          team_id: team,
          type: "O",
          name: "town-square",
          display_name: "Town Square",
          delete_at: 0,
        },
        {
          id: design,
          team_id: team,
          type: "P",
          name: "design",
          display_name: "Design",
          delete_at: 0,
        },
      ],
    ],
    [
      `users/me/teams/${team}/channels/members`,
      [town, design].map((channel_id) => ({
        channel_id,
        user_id: member,
        roles: channel_id === town ? "channel_user" : "fixture_reader",
      })),
    ],
    [
      `users/me/teams/${team}/channels/categories`,
      {
        order: [category],
        categories: [
          {
            id: category,
            user_id: member,
            team_id: team,
            type: "channels",
            display_name: "Channels",
            sorting: "manual",
            sort_order: 0,
            muted: false,
            collapsed: false,
            channel_ids: [town, design],
          },
        ],
      },
    ],
  ]);
  const channelId =
    path === `channels/${town}/posts`
      ? town
      : path === `channels/${design}/posts`
        ? design
        : null;
  const thread = path === `posts/${townRoot}/thread`;
  const policy =
    (path === "config/client" || path === "license/client") &&
    req.headers.authorization !== undefined;
  const post =
    path === "users/ids" ||
    path === "roles/names" ||
    path === "posts" ||
    path === "commands/execute";
  if (!routes.has(path) && !channelId && !thread && !policy && !post) return;
  assert.equal(req.headers.authorization, "Bearer fixture-browser-action");
  assert.equal(req.headers.cookie, undefined);
  assert.equal(req.method, post ? "POST" : "GET");
  if (policy) {
    assert.equal(url.search, "?format=old");
    return json(
      path === "config/client"
        ? { CollapsedThreads: "always_on", TeammateNameDisplay: "username" }
        : {},
      "live-" + path,
    );
  }
  if (thread) {
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      direction: "down",
      perPage: "60",
      collapsedThreads: "true",
    });
    const page = postList(town, member, "Town fixture message");
    const replyId = "w".repeat(26);
    const reply = {
      ...page.posts[townRoot],
      id: replyId,
      root_id: townRoot,
      create_at: 561,
      update_at: 561,
      message: "Reply visible only inside Town’s thread",
    };
    return json(
      {
        ...page,
        order: [townRoot, replyId],
        posts: { ...page.posts, [replyId]: reply },
        has_next: false,
      },
      "live-window-thread",
    );
  }
  if (channelId) {
    latest(url);
    return json(
      postList(
        channelId,
        member,
        channelId === town ? "Town fixture message" : "Design fixture message",
      ),
      "live-posts-" + channelId,
    );
  }
  if (post) {
    assert.equal(url.search, "");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (path === "commands/execute") {
      assert.deepEqual(body, {
        channel_id: town,
        team_id: team,
        command: "/me repeat from the window",
      });
      return json(
        {
          response_type: "ephemeral",
          text: "The fixture received the confirmed repeat.",
          username: "",
          channel_id: town,
          icon_url: "",
          type: "",
          props: null,
          goto_location: "",
          trigger_id: "",
          skip_slack_parsing: false,
          attachments: null,
          extra_responses: null,
        },
        "live-window-command-repeat",
      );
    }
    if (path === "posts") {
      const pending = body.pending_post_id;
      assert.equal(typeof pending, "string");
      assert.ok(pending.startsWith(member + ":"));
      const reply = body.message === "Posted from the thread window";
      assert.deepEqual(body, {
        channel_id: town,
        message: reply
          ? "Posted from the thread window"
          : "Posted from the channel window",
        ...(reply && { root_id: townRoot }),
        pending_post_id: pending,
      });
      return json(
        {
          id: (reply ? "windowreply" : "windowpost").padEnd(26, "0"),
          user_id: member,
          ...body,
          root_id: reply ? townRoot : "",
          delete_at: 0,
        },
        reply ? "live-window-send-reply" : "live-window-send",
        201,
      );
    }
    if (path === "roles/names") {
      const names = [
        "channel_user",
        "fixture_reader",
        "system_user",
        "team_user",
      ];
      assert.deepEqual(body.sort(), names);
      return json(
        names.map((name) => ({
          name,
          permissions:
            name === "channel_user" ||
            (name === "fixture_reader" && restoredPosting)
              ? ["create_post"]
              : [],
        })),
        "live-roles",
      );
    }
    assert.deepEqual(body, [member]);
    return json(
      [{ id: member, username: "fixture-author", update_at: 100 }],
      "live-authors",
    );
  }
  assert.equal(
    url.search,
    path.endsWith("/channels") ? "?include_deleted=true" : "",
  );
  return json(routes.get(path), "live-" + path.split("/").at(-1));
}
