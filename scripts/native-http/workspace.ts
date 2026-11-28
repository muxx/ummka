import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  deniedPost,
  systemReply as townReply,
  systemRoot as townRoot,
} from "../webview-check/link-examples.ts";

const team = "Team0123456789012345678901";
const town = "c".repeat(26);
const townFile = "h".repeat(26);
const replyFile = "g".repeat(26);
const earlierReplyId = "n".repeat(26);
const design = "d".repeat(26);
const member = "f".repeat(26);
const townMessage =
  "Town fixture message\n\n| Name | Score |\n| :- | -: |\n| Aurora | 17 |";
const cardEmbed = { embeds: [{ type: "message_attachment" }] };
const self = "s".repeat(26);
const directCategory = "m".repeat(26);

const townRoom = {
  id: town,
  team_id: team,
  type: "O",
  name: "town-square",
  display_name: "Town Square",
  delete_at: 0,
};
const publicRoom = {
  id: "z".repeat(26),
  team_id: team,
  name: "release-notes",
  display_name: "Release Notes",
  type: "O",
  header: "Upcoming releases",
  purpose: "Release announcements",
  delete_at: 0,
};

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
function postList(
  channelId: string,
  userId: string,
  message: string,
  id = channelId === town
    ? townRoot
    : channelId === self
      ? "personalnote".padEnd(26, "0")
      : "y".repeat(26),
) {
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
        ...(channelId === town &&
          userId === member &&
          id === townRoot && {
            file_ids: [townFile],
            ...(message === townMessage && {
              props: {
                attachments: [
                  {
                    title: "Workspace release status",
                    text: "**Current build passed**",
                  },
                ],
              },
            }),
            metadata: {
              ...(message === townMessage && cardEmbed),
              files: [
                {
                  id: townFile,
                  name: "window-fixture.pdf",
                  size: 42,
                  mime_type: "application/pdf",
                },
              ],
            },
          }),
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
  {
    joinedPublicRoom = false,
    systemLinks = false,
    acceptedThreadReply = false,
    ordinaryReadingThread = false,
    browserToken = "fixture-browser-action",
    visible,
  }: {
    joinedPublicRoom?: boolean;
    systemLinks?: boolean;
    acceptedThreadReply?: boolean;
    ordinaryReadingThread?: boolean;
    browserToken?: string;
    visible?: { selfOpenedAt?: string };
  } = {},
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
  if (
    visible &&
    path === "users/me/preferences" &&
    (req.method === "PUT" || visible.selfOpenedAt)
  ) {
    assert.equal(req.headers.authorization, `Bearer ${browserToken}`);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(url.search, "");
    const ownRows = (stamp: string) => [
      {
        user_id: member,
        category: "direct_channel_show",
        name: member,
        value: "true",
      },
      {
        user_id: member,
        category: "channel_open_time",
        name: self,
        value: stamp,
      },
    ];
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const rows = JSON.parse(Buffer.concat(chunks).toString());
      const stamp = rows[1]?.value;
      assert.equal(typeof stamp, "string");
      assert.match(stamp, /^[1-9]\d+$/);
      assert.deepEqual(rows, ownRows(stamp));
      visible.selfOpenedAt = stamp;
      return json({ status: "OK" }, "live-show-personal-conversation");
    }
    assert.equal(req.method, "GET");
    assert.ok(visible.selfOpenedAt);
    return json(
      ownRows(visible.selfOpenedAt),
      "browser-entry-users/me/preferences",
    );
  }
  if (
    path === `users/me/teams/${team}/threads` &&
    url.searchParams.get("totalsOnly") === "true"
  ) {
    assert.equal(req.method, "GET");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      totalsOnly: "true",
    });
    assert.ok(req.headers.authorization?.startsWith("Bearer "));
    return json(
      {
        total: 0,
        total_unread_threads: 0,
        total_unread_mentions: 0,
        total_unread_urgent_mentions: 0,
        threads: null,
      },
      "background-thread-totals",
    );
  }
  const joinedIds = joinedPublicRoom
    ? [town, design, publicRoom.id]
    : [town, design];
  const routes = new Map<string, unknown>([
    [
      `users/me/teams/${team}/channels`,
      [
        townRoom,
        {
          id: design,
          team_id: team,
          type: "P",
          name: "design",
          display_name: "Design",
          delete_at: 0,
        },
        ...(joinedPublicRoom ? [publicRoom] : []),
        ...(visible
          ? [
              {
                id: self,
                team_id: "",
                type: "D",
                name: `${member}__${member}`,
                display_name: "",
                delete_at: 0,
              },
            ]
          : []),
      ],
    ],
    [
      `users/me/teams/${team}/channels/members`,
      [...joinedIds, ...(visible ? [self] : [])].map((channel_id) => ({
        channel_id,
        user_id: member,
        roles: channel_id === design ? "fixture_reader" : "channel_user",
      })),
    ],
    [
      `users/me/teams/${team}/channels/categories`,
      {
        order: [category, directCategory],
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
            channel_ids: joinedIds,
          },
          {
            id: directCategory,
            user_id: member,
            team_id: team,
            type: "direct_messages",
            display_name: "Direct Messages",
            sorting: "recent",
            sort_order: 1,
            muted: false,
            collapsed: false,
            channel_ids: visible ? [self] : [],
          },
        ],
      },
    ],
  ]);
  const townText = systemLinks
    ? `[Open published reply](/system-post-check/browser/pl/${townReply})`
    : townMessage;
  const townPage = postList(town, member, townText);
  const message = townPage.posts[townRoot];
  const fileInfo = {
    id: townFile,
    channel_id: town,
    post_id: townRoot,
    user_id: member,
    name: "window-fixture.pdf",
  };
  const reply = {
    ...message,
    id: townReply,
    root_id: townRoot,
    create_at: 561,
    update_at: 561,
    message: systemLinks
      ? [
          "| Destination |",
          "| :- |",
          `| [Open published root](/system-post-check/browser/pl/${townRoot}) |`,
          ...Array.from({ length: 42 }, (_, index) => `| Example ${index} |`),
          "| [Unsupported conversation](/system-post-check/browser/channels/town-square) |",
          `| [Denied published message](/system-post-check/browser/pl/${deniedPost}) |`,
        ].join("\n")
      : "Reply visible only inside Town’s thread\n\n| Reply col |\n| :- |\n| First | **Exact overflow cell** |",
    file_ids: [replyFile],
    ...(systemLinks
      ? {}
      : {
          props: {
            attachments: [
              {
                title: "Thread release status",
                text: "**Reply build passed**",
              },
            ],
          },
        }),
    metadata: {
      ...(systemLinks ? {} : cardEmbed),
      files: [
        {
          id: replyFile,
          name: "reply-photo.png",
          size: 0,
          mime_type: "image/png",
        },
      ],
    },
  };
  const earlierReply = {
    ...reply,
    id: earlierReplyId,
    create_at: 560,
    update_at: 560,
    message: "Earlier reply by the same author.",
    props: undefined,
    file_ids: [],
    metadata: undefined,
  };
  const destination = {
    channel_id: town,
    channel_type: "O",
    channel_display_name: "Town Square",
    has_joined_channel: true,
    team_id: team,
    team_type: "O",
    team_display_name: "Fixture team",
    has_joined_team: true,
  };
  const anchors = new Map<string, [unknown, string]>([
    [`files/${townFile}/info`, [fileInfo, "live-search-file-anchor"]],
    [`posts/${townRoot}/info`, [destination, "live-search-destination"]],
    [`posts/${townRoot}`, [message, "live-search-post-anchor"]],
    [
      `posts/${townReply}/info`,
      [
        destination,
        systemLinks
          ? "system-reply-destination"
          : "live-search-reply-destination",
      ],
    ],
    [
      `posts/${townReply}`,
      [reply, systemLinks ? "system-reply-anchor" : "live-search-reply-anchor"],
    ],
  ]);
  const channelId =
    path === `channels/${town}/posts`
      ? town
      : path === `channels/${design}/posts`
        ? design
        : path === `channels/${self}/posts`
          ? self
          : null;
  const countRoom = joinedIds.find((id) => path === `channels/${id}/stats`);
  const listRooms = path === `teams/${team}/channels`;
  const queryRooms = path === `teams/${team}/channels/autocomplete`;
  const joinRoom = path === `channels/${publicRoom.id}/members`;
  const joinedPosts = path === `channels/${publicRoom.id}/posts`;
  const thread = path === `posts/${townRoot}/thread`;
  const policy =
    (path === "config/client" || path === "license/client") &&
    req.headers.authorization !== undefined;
  const searchPosts = path === `teams/${team}/posts/search`;
  const searchFiles = path === `teams/${team}/files/search`;
  const namedTeam = systemLinks && path === "teams/name/browser";
  const namedChannel =
    systemLinks && path === `teams/name/browser/channels/name/${townRoom.name}`;
  const post =
    joinRoom ||
    searchPosts ||
    searchFiles ||
    path === "users/ids" ||
    path === "roles/names" ||
    path === "posts" ||
    path === "commands/execute";
  if (
    !routes.has(path) &&
    !anchors.has(path) &&
    !channelId &&
    !countRoom &&
    !listRooms &&
    !queryRooms &&
    !joinedPosts &&
    !thread &&
    !policy &&
    !namedTeam &&
    !namedChannel &&
    !post
  )
    return;
  assert.equal(
    req.headers.authorization,
    systemLinks ? "Bearer fixture-system-post" : `Bearer ${browserToken}`,
  );
  assert.equal(req.headers.cookie, undefined);
  assert.equal(req.method, post ? "POST" : "GET");
  if (countRoom) {
    assert.equal(url.search, "?exclude_files_count=true");
    return json(
      { channel_id: countRoom, member_count: countRoom === town ? 30 : 7 },
      "info-channel-members",
    );
  }
  if (namedTeam) {
    assert.equal(url.search, "");
    return json(
      {
        id: team,
        name: "browser",
        display_name: "Browser team",
        type: "O",
        delete_at: 0,
      },
      "system-named-team",
    );
  }
  if (namedChannel) {
    assert.equal(url.search, "?include_deleted=true");
    return json(townRoom, "system-named-channel");
  }
  if (listRooms || queryRooms) {
    assert.deepEqual(
      Object.fromEntries(url.searchParams),
      listRooms ? { page: "0", per_page: "50" } : { name: "release" },
    );
    return json([publicRoom], listRooms ? "directory-page" : "directory-query");
  }
  if (joinedPosts) {
    assert.ok(
      joinedPublicRoom,
      "Directory details requested posts before joining",
    );
    latest(url);
    return json(
      postList(
        publicRoom.id,
        member,
        "Welcome to Release Notes",
        "j".repeat(26),
      ),
      "directory-posts",
    );
  }
  const anchor = anchors.get(path);
  if (anchor) {
    assert.equal(url.search, "");
    return json(...anchor);
  }
  if (policy) {
    assert.equal(url.search, "?format=old");
    return json(
      path === "config/client"
        ? {
            CollapsedThreads: "always_on",
            TeammateNameDisplay: "username",
            EnableFileAttachments: "true",
            EnableFileSearch: "true",
          }
        : {},
      "live-" + path,
    );
  }
  if (thread) {
    const page = {
      ...townPage,
      posts: { [townRoot]: { ...message, is_following: acceptedThreadReply } },
    };
    const query = Object.fromEntries(url.searchParams);
    assert.equal(url.searchParams.size, Object.keys(query).length);
    if (query.perPage === "1") {
      assert(
        acceptedThreadReply && !systemLinks,
        "Subscription read before the accepted thread reply",
      );
      assert.deepEqual(query, {
        direction: "down",
        perPage: "1",
        collapsedThreads: "true",
      });
      return json(
        {
          ...page,
          order: [townRoot, earlierReplyId],
          posts: { ...page.posts, [earlierReplyId]: earlierReply },
          has_next: true,
        },
        "live-window-follow-source",
      );
    }
    if (query.fromPost !== undefined) {
      assert.ok(query.direction === "up" || query.direction === "down");
      assert.deepEqual(query, {
        direction: query.direction,
        fromPost: townReply,
        fromCreateAt: String(reply.create_at),
        perPage: "60",
        collapsedThreads: "true",
      });
      return json(
        { ...page, has_next: false },
        systemLinks
          ? "live-window-thread"
          : "live-search-thread-" + query.direction,
      );
    }
    assert.deepEqual(query, {
      direction: "down",
      perPage: "60",
      collapsedThreads: "true",
      ...(systemLinks &&
        !ordinaryReadingThread && {
          skipFetchThreads: "false",
          collapsedThreadsExtended: "false",
        }),
    });
    return json(
      {
        ...page,
        order: systemLinks
          ? [townRoot, townReply]
          : [townRoot, earlierReplyId, townReply],
        posts: {
          ...page.posts,
          ...(systemLinks ? {} : { [earlierReplyId]: earlierReply }),
          [townReply]: reply,
        },
        has_next: false,
      },
      "live-window-thread",
    );
  }
  if (channelId) {
    if (systemLinks) {
      const side = url.searchParams.has("before") ? "before" : "after";
      assert.equal(channelId, town);
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        [side]: townRoot,
        page: "0",
        per_page: "30",
        skipFetchThreads: "false",
        collapsedThreads: "true",
        collapsedThreadsExtended: "false",
      });
      return json(
        {
          order: [],
          posts: {},
          next_post_id: "",
          prev_post_id: "",
          first_inaccessible_post_time: 0,
        },
        "system-neighbors-" + side,
      );
    }
    latest(url);
    return json(
      postList(
        channelId,
        member,
        channelId === town
          ? townMessage
          : channelId === self
            ? "Personal fixture message"
            : "Design fixture message",
      ),
      "live-posts-" + channelId,
    );
  }
  if (post) {
    assert.equal(url.search, "");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (joinRoom) {
      assert.equal(
        joinedPublicRoom,
        false,
        "Directory sent the membership request twice",
      );
      assert.deepEqual(body, { user_id: member });
      return json(
        { channel_id: publicRoom.id, user_id: member },
        "directory-join",
        201,
      );
    }
    if (searchPosts || searchFiles) {
      assert.deepEqual(body, {
        terms: "window fixture",
        page: 0,
        per_page: 20,
        time_zone_offset: 20700,
        include_deleted_channels: true,
        is_or_search: false,
      });
      if (searchPosts) {
        const page = postList(town, member, "Search found this fixture post");
        return json(
          {
            ...page,
            order: [townReply, townRoot],
            posts: {
              ...page.posts,
              [townReply]: { ...reply, message: "Search found this reply" },
            },
            matches: {},
          },
          "live-search-posts",
        );
      }
      return json(
        {
          order: [townFile],
          file_infos: { [townFile]: fileInfo },
          first_inaccessible_file_time: 0,
          prev_file_info_id: "",
          next_file_info_id: "",
        },
        "live-search-files",
      );
    }
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
            name === "team_user"
              ? ["list_team_channels", "join_public_channels"]
              : name === "channel_user" ||
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
