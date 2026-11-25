import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

const team = "Team0123456789012345678901";
const town = "c".repeat(26);
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
  const id = (channelId === town ? "v" : "y").repeat(26);
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
): Promise<string | undefined> {
  function json(value: unknown, name: string) {
    res
      .writeHead(200, { "Content-Type": "application/json" })
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
      [town, design].map((channel_id) => ({ channel_id, user_id: member })),
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
  const policy =
    (path === "config/client" || path === "license/client") &&
    req.headers.authorization !== undefined;
  if (!routes.has(path) && !channelId && !policy && path !== "users/ids")
    return;
  assert.equal(req.headers.authorization, "Bearer fixture-browser-action");
  assert.equal(req.headers.cookie, undefined);
  assert.equal(req.method, path === "users/ids" ? "POST" : "GET");
  if (policy) {
    assert.equal(url.search, "?format=old");
    return json(
      path === "config/client"
        ? { CollapsedThreads: "always_on", TeammateNameDisplay: "username" }
        : {},
      "live-" + path,
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
  if (path === "users/ids") {
    assert.equal(url.search, "");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), [member]);
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
