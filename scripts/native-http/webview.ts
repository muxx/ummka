import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import https from "node:https";
import type { Socket } from "node:net";
import { json, text } from "node:stream/consumers";
import { respondToAccount } from "./account.ts";
import type { SendAndroidKey } from "./android-webview.ts";
import { respondToChannelMembers } from "./channel-members.ts";
import { respondToChannelView } from "./channel-view.ts";
import { respondToGroupAssociations } from "./group-associations.ts";
import { respondToGroupAudience } from "./group-audience.ts";
import { respondToHistory } from "./history.ts";
import { historyRefreshFixture } from "./history-refresh.ts";
import { respondToPostContext } from "./post-context.ts";
import { respondToPostMutation } from "./post-mutations.ts";
import { submissionFixture } from "./submit-post.ts";
import { respondToThreadList } from "./thread-list.ts";
import { respondToThreadRead } from "./thread-read-state.ts";
import { respondToWorkspace } from "./workspace.ts";

export function webviewServers(
  trusted: https.ServerOptions,
  untrusted: https.ServerOptions,
) {
  const cases = [
    "headers",
    "body",
    "owner",
    "reload",
    "window",
    "ping-headers",
    "ping-body",
    "batch-headers",
    "batch-body",
    "account-error-body",
    "account-retire",
    "refresh-late",
    "submit-post",
  ];
  const events = new EventEmitter();
  // Each fixture signal fires once and has no error event.
  const signal = (event: string) =>
    new Promise<void>((resolve) => events.once(event, resolve));
  const held = new Map(
    cases.map((name) => [
      name,
      {
        received: signal(`${name}-received`),
        closed: signal(`${name}-closed`),
      },
    ]),
  );
  const visits: string[] = [];
  let offlineHistoryRequests = 0;
  let connections = 0;
  let before = false;
  let prepareKeyboard: (() => Promise<void>) | undefined;
  let pressThreadBack: (() => Promise<void>) | undefined;
  let disconnect: Socket | undefined;
  let pingSocket: Socket | undefined;
  const settings = new Map<string, ServerResponse>();
  const entrySettings = new Map<string, ServerResponse>();
  const userId = "Abc01234567890123456789012";
  const submissions = submissionFixture(userId, () =>
    events.emit("submit-post-received"),
  );
  const refresh = historyRefreshFixture(userId, () =>
    events.emit("refresh-late-received"),
  );
  const teamId = "Team0123456789012345678901";
  const channelId = "c".repeat(26);
  const teamReads = new Map<string, { name: string; body: object | null }>([
    [
      `/team/chat/api/v4/channels/${"j".repeat(26)}`,
      {
        name: "signed-single-channel",
        body: { id: "j".repeat(26), type: "G", team_id: "", delete_at: 0 },
      },
    ],
    [
      `/team/chat/api/v4/teams/${teamId}/channels/managed_categories`,
      {
        name: "managed-category-mappings",
        body: { [channelId]: "Release", ["d".repeat(26)]: "Release" },
      },
    ],
    [
      `/api/v4/posts/${"p".repeat(26)}/reactions`,
      { name: "empty-post-reactions", body: null },
    ],
    [
      `/team/chat/api/v4/posts/${"p".repeat(26)}/reactions`,
      {
        name: "post-reactions",
        body: [
          {
            user_id: userId,
            post_id: "p".repeat(26),
            channel_id: channelId,
            emoji_name: "+1",
            create_at: 32,
            update_at: 34,
            delete_at: 0,
            remote_id: null,
          },
        ],
      },
    ],
    [
      "/team/chat/api/v4/emoji/name/fixture%2Bwave",
      {
        name: "custom-emoji-by-name",
        body: {
          id: "e".repeat(26),
          creator_id: userId,
          name: "fixture+wave",
          create_at: 42,
          update_at: 43,
          delete_at: 0,
        },
      },
    ],
    [
      "/api/v4/users/me/teams",
      {
        name: "my-teams",
        body: [
          { id: teamId, display_name: "Fixture Team", group_constrained: true },
        ],
      },
    ],
    [
      "/team/chat/api/v4/users/me/teams",
      {
        name: "directory-teams",
        body: [
          {
            id: teamId,
            name: "fixture",
            display_name: "Fixture Team",
            group_constrained: true,
            delete_at: 0,
          },
        ],
      },
    ],
    [
      "/team/chat/api/v4/users/me/teams/members",
      {
        name: "my-team-members",
        body: [
          {
            team_id: teamId,
            user_id: userId,
            roles: "team_guest",
            scheme_guest: true,
            scheme_user: false,
            scheme_admin: false,
            explicit_roles: "",
            delete_at: 0,
          },
        ],
      },
    ],
    [
      `/team/chat/api/v4/users/me/teams/${teamId}/channels?include_deleted=false&last_delete_at=123`,
      {
        name: "team-channels",
        body: [
          {
            id: channelId,
            team_id: teamId,
            name: "town-square",
            group_constrained: true,
          },
        ],
      },
    ],
    [
      `/team/chat/api/v4/users/${userId}/teams/${teamId}/channels/members`,
      {
        name: "team-memberships",
        body: [{ channel_id: channelId, user_id: userId }],
      },
    ],
    [
      `/team/chat/api/v4/users/me/teams/${teamId}/channels/categories`,
      {
        name: "sidebar-categories",
        body: {
          order: ["m".repeat(26)],
          categories: [
            {
              id: "m".repeat(26),
              user_id: userId,
              team_id: teamId,
              type: "managed",
              display_name: "Managed channels",
              channel_ids: [channelId],
              sorting: "manual",
              sort_order: 0,
              muted: false,
              collapsed: true,
            },
          ],
        },
      },
    ],
    [
      "/team/chat/api/v4/users/me/preferences",
      {
        name: "sidebar-preferences",
        body: [
          {
            user_id: userId,
            category: "direct_channel_show",
            name: "d".repeat(26),
            value: "false",
          },
          {
            user_id: userId,
            category: "channel_approximate_view_time",
            name: "historical-channel-key",
            value: "unrelated",
          },
          {
            user_id: userId,
            category: "channel_open_time",
            name: channelId,
            value: "310",
          },
          {
            user_id: userId,
            category: "sidebar_settings",
            name: "limit_visible_dms_gms",
            value: "18",
          },
          {
            user_id: userId,
            category: "display_settings",
            name: "name_format",
            value: "nickname_full_name",
          },
          {
            user_id: userId,
            category: "advanced_settings",
            name: "send_on_ctrl_enter",
            value: "true",
          },
          {
            user_id: userId,
            category: "advanced_settings",
            name: "code_block_ctrl_enter",
            value: "false",
          },
        ],
      },
    ],
    [
      `/team/chat/api/v4/users/me/teams/${teamId}/channels?include_deleted=true`,
      {
        name: "directory-channels",
        body: [
          {
            id: channelId,
            type: "O",
            team_id: teamId,
            name: "town-square",
            display_name: "Town Square",
            delete_at: 0,
            create_at: 90,
            group_constrained: true,
            last_root_post_at: 300,
            shared: true,
          },
        ],
      },
    ],
    [
      `/team/chat/api/v4/users/me/teams/${teamId}/channels/members`,
      {
        name: "directory-channel-members",
        body: [
          {
            channel_id: channelId,
            user_id: userId,
            roles: "channel_user custom_writer",
            mention_count_root: 2,
          },
        ],
      },
    ],
  ]);
  function hold(name: string, req: IncomingMessage, res: ServerResponse) {
    req.socket.once("close", () => events.emit(`${name}-closed`));
    events.emit(`${name}-received`);
    if (name === "body" || name.endsWith("-body"))
      res.writeHead(200, { "Content-Length": "100" }).write("A");
  }
  const data = https.createServer(trusted, async (req, res) => {
    const url = new URL(req.url ?? "/", "https://localhost");
    if (url.pathname === "/team/chat/api/v4/reactions") {
      assert.equal(req.method, "POST");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers["content-type"], "application/json");
      const fields = {
        user_id: userId,
        post_id: "p".repeat(26),
        emoji_name: "+1",
      };
      assert.deepEqual(await json(req), fields);
      visits.push("save-post-reaction");
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          ...fields,
          channel_id: channelId,
          create_at: 42,
          update_at: 42,
          delete_at: 0,
          remote_id: "",
        }),
      );
      return;
    }
    if (
      url.pathname ===
      `/team/chat/api/v4/users/me/posts/${"p".repeat(26)}/reactions/%2B1`
    ) {
      assert.equal(req.method, "DELETE");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers.cookie, undefined);
      assert.equal(url.search, "");
      visits.push("delete-post-reaction");
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ status: "OK" }));
      return;
    }
    if (url.pathname === "/team/chat/api/v4/users/usernames") {
      assert.equal(req.method, "POST");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers["content-type"], "application/json");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), [
        "unknown",
        "fixture",
      ]);
      visits.push("profiles-by-name");
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify([{ id: userId, username: "fixture" }]));
      return;
    }
    if (url.pathname === `/team/chat/api/v4/users/${userId}/image`) {
      assert.equal(req.method, "GET");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      visits.push("profile-image");
      res
        .writeHead(200, { "Content-Type": "image/png" })
        .end(
          readFileSync(
            new URL(
              "../../src-tauri/icons/linux/hicolor/48x48/apps/ummka.png",
              import.meta.url,
            ),
          ),
        );
      return;
    }
    if (refresh.handle(req, res, url)) return;
    if (url.pathname === "/team/chat/api/v4/roles/names") {
      assert.equal(req.method, "POST");
      assert.equal(url.search, "");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers.cookie, undefined);
      assert.equal(req.headers["content-type"], "application/json");
      const names = await json(req);
      if (Array.isArray(names) && names.length === 1) {
        assert.deepEqual(names, ["fixture_missing"]);
        visits.push("absent-roles");
        res.writeHead(200, { "Content-Type": "application/json" }).end("null");
        return;
      }
      if (Array.isArray(names) && names.includes("system_user")) {
        assert.deepEqual([...names].sort(), [
          "channel_user",
          "custom_writer",
          "system_user",
          "team_guest",
        ]);
        visits.push("saved-role-definitions");
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify([
            { name: "channel_user", permissions: ["create_post"] },
            { name: "system_user", permissions: ["create_direct_channel"] },
            { name: "team_guest", permissions: [] },
          ]),
        );
        return;
      }
      assert.deepEqual(names, ["team_guest", "channel_user"]);
      visits.push("role-definitions");
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify([
          {
            name: "channel_user",
            display_name: "Channel member",
            scheme_managed: true,
            permissions: ["read_channel", "create_post"],
          },
          {
            name: "team_guest",
            display_name: "Team guest",
            scheme_managed: true,
            permissions: [],
          },
        ]),
      );
      return;
    }
    if (url.pathname.startsWith("/offline-history/")) {
      offlineHistoryRequests++;
      res.writeHead(503, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          id: "fixture.unavailable",
          message: "Offline history fixture",
          status_code: 503,
        }),
      );
      return;
    }
    const customCategory = "m".repeat(26);
    const builtin = `direct_messages_${userId.toLowerCase()}_${teamId.toLowerCase()}`;
    const categoryRoute = `/team/chat/api/v4/users/me/teams/${teamId}/channels/categories`;
    if (
      url.pathname === `${categoryRoute}/${builtin}` ||
      url.pathname === `${categoryRoute}/${customCategory}`
    ) {
      assert.equal(url.search, "");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers.cookie, undefined);
      let result: Record<string, unknown>;
      if (url.pathname.endsWith(builtin)) {
        assert.equal(req.method, "PUT");
        assert.equal(req.headers["content-type"], "application/json");
        result = {
          id: builtin,
          team_id: teamId,
          user_id: userId,
          type: "direct_messages",
          channel_ids: [channelId],
          collapsed: true,
        };
        assert.deepEqual(await json(req), result);
        visits.push("collapse-sidebar-category");
      } else {
        assert.equal(req.method, "DELETE");
        assert.equal(await text(req), "");
        result = { status: "OK" };
        visits.push("remove-sidebar-category");
      }
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(result));
      return;
    }
    const readThread = await respondToThreadRead(req, res, url, teamId);
    if (readThread) {
      visits.push(readThread);
      return;
    }
    const threadList = await respondToThreadList(
      req,
      res,
      url,
      teamId,
      channelId,
      userId,
    );
    if (threadList) {
      visits.push(threadList);
      return;
    }
    if (
      url.pathname ===
      `/team/chat/api/v4/users/me/teams/${teamId}/threads/${"p".repeat(26)}/following`
    ) {
      assert(req.method === "PUT" || req.method === "DELETE");
      assert.equal(url.search, "");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers.cookie, undefined);
      assert.equal(await text(req), "");
      visits.push(req.method === "PUT" ? "follow-thread" : "unfollow-thread");
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ status: "OK" }));
      return;
    }
    const mutation = await respondToPostMutation(
      req,
      res,
      url,
      channelId,
      userId,
      submissions,
    );
    if (mutation) {
      visits.push(mutation);
      return;
    }
    const workspace = await respondToWorkspace(
      req,
      res,
      url,
      userId,
      visits.includes("live-roles"),
    );
    if (workspace) {
      visits.push(workspace);
      return;
    }
    const account = respondToAccount(req, res, url, userId, (name) =>
      events.emit(name),
    );
    if (account) {
      visits.push(account);
      return;
    }
    if (url.pathname === "/team/chat/api/v4/commands/execute") {
      assert.equal(req.method, "POST");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers.cookie, undefined);
      assert.equal(url.search, "");
      const command = await json(req);
      assert(command && typeof command === "object" && "root_id" in command);
      const saved = command.root_id === "k".repeat(26);
      assert.deepEqual(command, {
        channel_id: channelId,
        team_id: teamId,
        root_id: (saved ? "k" : "r").repeat(26),
        command: saved ? "/release --Saved" : "/release --Status",
      });
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          response_type: "ephemeral",
          text: "Fixture status",
          username: "Integration",
          channel_id: channelId,
          icon_url: "",
          type: "",
          props: null,
          goto_location: "",
          trigger_id: "",
          skip_slack_parsing: false,
          attachments: null,
          extra_responses: null,
        }),
      );
      visits.push(saved ? "saved-slash-command" : "signed-slash-command");
      return;
    }
    if (
      url.pathname === "/team/chat/api/v4/groups" ||
      url.pathname === "/api/v4/groups"
    ) {
      const prefixed = url.pathname.startsWith("/team/chat/");
      assert.equal(req.method, "GET");
      assert.equal(req.headers.cookie, undefined);
      assert.equal(
        req.headers.authorization,
        prefixed
          ? "Bearer fixture-prefixed-session"
          : "Bearer fixture-root-session",
      );
      assert.deepEqual(
        Object.fromEntries(url.searchParams),
        prefixed
          ? {
              q: "release qa",
              page: "0",
              per_page: "60",
              filter_allow_reference: "true",
              include_member_count: "true",
            }
          : { q: "absent", filter_allow_reference: "true" },
      );
      const result = prefixed
        ? [
            {
              id: "g".repeat(26),
              name: "release-qa",
              display_name: "Release QA",
              source: "custom",
              remote_id: null,
              allow_reference: true,
              member_count: 7,
            },
            {
              id: "h".repeat(26),
              name: "qa",
              display_name: "Release QA Directory",
              source: "ldap",
              remote_id: "directory-record",
              allow_reference: true,
              member_count: 3,
            },
          ]
        : [];
      visits.push(prefixed ? "group-directory-page" : "group-directory-empty");
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(result));
      return;
    }
    const associations = respondToGroupAssociations(
      req,
      res,
      url,
      teamId,
      channelId,
    );
    if (associations) {
      visits.push(associations);
      return;
    }
    const groupAudience = respondToGroupAudience(req, res, url, channelId);
    if (groupAudience) {
      visits.push(groupAudience);
      return;
    }
    if (url.pathname === `/team/chat/api/v4/channels/${channelId}/timezones`) {
      assert.equal(req.method, "GET");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers.cookie, undefined);
      assert.equal(url.search, "");
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(["Europe/Moscow", "Asia/Tokyo"]));
      visits.push("broadcast-timezones");
      return;
    }
    const stats =
      url.pathname === `/team/chat/api/v4/channels/${channelId}/stats`;
    if (stats || url.pathname === `/api/v4/channels/${channelId}/timezones`) {
      assert.equal(req.method, "GET");
      assert.equal(req.headers.cookie, undefined);
      assert.equal(
        req.headers.authorization,
        stats
          ? "Bearer fixture-prefixed-session"
          : "Bearer fixture-root-session",
      );
      assert.equal(url.search, stats ? "?exclude_files_count=true" : "");
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify(
          stats
            ? {
                channel_id: channelId,
                member_count: 30,
                guest_count: 3,
                pinnedpost_count: 5,
                files_count: -1,
              }
            : null,
        ),
      );
      visits.push(stats ? "channel-stats" : "channel-timezones");
      return;
    }
    const ownTeam = `/team/chat/api/v4/teams/${teamId}/members`;
    if (url.pathname === ownTeam || url.pathname === `${ownTeam}/${userId}`) {
      const join = url.pathname === ownTeam;
      assert.equal(url.search, "");
      assert.equal(req.method, join ? "POST" : "DELETE");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers.cookie, undefined);
      if (join) {
        assert.equal(req.headers["content-type"], "application/json");
        assert.deepEqual(await json(req), { team_id: teamId, user_id: userId });
      }
      res
        .writeHead(join ? 201 : 200, { "Content-Type": "application/json" })
        .end(
          JSON.stringify(
            join
              ? { team_id: teamId, user_id: userId, delete_at: 0 }
              : { status: "OK" },
          ),
        );
      visits.push(join ? "own-team-join" : "own-team-leave");
      return;
    }
    const member = await respondToChannelMembers(
      req,
      res,
      url,
      channelId,
      userId,
    );
    if (member) {
      visits.push(member);
      return;
    }
    const view = await respondToChannelView(
      req,
      res,
      url,
      channelId,
      teamId,
      userId,
    );
    if (view) {
      visits.push(view);
      return;
    }
    const post = respondToPostContext(req, res, url, channelId, teamId);
    if (post) {
      visits.push(post);
      return;
    }
    const history = respondToHistory(req, res, url, channelId, userId);
    if (history) {
      visits.push(history);
      return;
    }
    if (
      url.pathname === "/team/chat/api/v4/users/ids" ||
      url.pathname === "/api/v4/users/ids"
    ) {
      const signed = url.pathname.startsWith("/team/chat/");
      const name = `batch-${req.headers["x-test-case"] ?? (signed ? "signed" : "anonymous")}`;
      visits.push(name);
      assert.equal(req.method, "POST");
      assert.equal(req.headers.cookie, undefined);
      assert.equal(
        req.headers.authorization,
        signed ? "Bearer fixture-prefixed-session" : undefined,
      );
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      if (name === "batch-text") {
        assert.equal(url.search, "");
        assert.equal(
          req.headers["content-type"],
          "application/json; charset=utf-8",
        );
        assert.deepEqual(
          Buffer.concat(chunks),
          Buffer.from('\ufeff ["Привет 👋"]\n'),
        );
        res.writeHead(204).end();
        return;
      }
      const ids = [userId, "b".repeat(26)];
      assert.equal(url.search, "?since=123");
      assert.equal(req.headers["content-type"], "application/json");
      assert.deepEqual(Buffer.concat(chunks), Buffer.from(JSON.stringify(ids)));
      if (held.has(name)) {
        hold(name, req, res);
        return;
      }
      res.writeHead(signed ? 200 : 401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          signed
            ? [
                { id: ids[1], first_name: "Юлия" },
                { id: userId, first_name: "Ada" },
              ]
            : { message: "session required" },
        ),
      );
      return;
    }
    assert.equal(req.method, "GET");
    const teamRead = teamReads.get(url.pathname + url.search);
    if (teamRead) {
      visits.push(teamRead.name);
      assert.equal(
        req.headers.authorization,
        url.pathname.startsWith("/team/chat/")
          ? "Bearer fixture-prefixed-session"
          : "Bearer fixture-root-session",
      );
      assert.equal(req.headers.cookie, undefined);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(teamRead.body));
      return;
    }
    if (url.pathname === "/api/v4/users/me") {
      visits.push("user-me");
      assert.equal(url.search, "");
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.cookie, undefined);
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "session required" }));
      return;
    }
    if (url.pathname === `/team/chat/api/v4/users/${userId}`) {
      visits.push("user-profile");
      assert.equal(url.search, "");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers.cookie, undefined);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ id: userId, username: "fixture", first_name: "Ada" }),
      );
      return;
    }
    const setting =
      /^\/(team\/chat|entry\/team)\/api\/v4\/(config|license)\/client$/.exec(
        url.pathname,
      );
    if (setting?.[1] === "team/chat" && req.headers.authorization) {
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers.cookie, undefined);
      assert.equal(url.search, "?format=old");
      visits.push(`workspace-${setting[2]}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          setting[2] === "config"
            ? {
                CollapsedThreads: "always_on",
                RestrictDirectMessage: "team",
                FeatureFlagEnableSharedChannelsDMs: "true",
                EnableConfirmNotificationsToChannel: "false",
                MaxNotificationsPerChannel: "9223372036854775807",
                UniqueEmojiReactionLimitPerPost: "-2",
                PostEditTimeLimit: "9007199254740993",
                EnableCrossTeamSearch: "true",
                EnableFileAttachments: "true",
                EnableFileSearch: "false",
                EnableCustomGroups: "true",
                TeammateNameDisplay: "full_name",
                LockTeammateNameDisplay: "true",
                Unrelated: "ignored",
              }
            : {
                LockTeammateNameDisplay: "true",
                IsLicensed: "true",
                LDAPGroups: "true",
                Company: "ignored",
              },
        ),
      );
      return;
    }
    if (setting) {
      assert.equal(url.search, "?format=old");
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.cookie, undefined);
      const entry = setting[1] === "entry/team";
      const reports = entry ? entrySettings : settings;
      assert(!reports.has(setting[2]), "each profile operation is sent once");
      reports.set(setting[2], res);
      if (reports.size === 2) {
        for (const [name, response] of reports) {
          const body =
            name === "config"
              ? {
                  Version: "10.10.1",
                  SiteName: entry ? "Entry fixture" : "Fixture",
                  EnableSignInWithEmail: entry ? "true" : "false",
                  EnableSignUpWithGitLab: "true",
                }
              : { IsLicensed: "false" };
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify(body));
        }
      }
      return;
    }
    const rootPing = url.pathname === "/api/v4/system/ping";
    const generated = url.searchParams.has("use_rest_semantics");
    let name = url.searchParams.get("check") ?? "";
    if (generated) {
      assert.equal(url.search, "?use_rest_semantics=true");
      assert.equal(req.headers.cookie, undefined);
      assert.equal(req.headers.authorization, undefined);
      name = `ping-${req.headers["x-test-case"] ?? (rootPing ? "root" : "prefix")}`;
    }
    if (!(generated && rootPing))
      assert.equal(url.pathname, "/team/chat/api/v4/system/ping");
    visits.push(name);
    if (held.has(name)) {
      hold(name, req, res);
      return;
    }
    if (name === "ping-root" || name === "ping-prefix") {
      if (name === "ping-prefix") {
        if (pingSocket)
          assert.equal(
            req.socket,
            pingSocket,
            "sequential generated requests must reuse the connection",
          );
        pingSocket = req.socket;
      }
      res.setHeader("Set-Cookie", "previous=ignored; Path=/");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "OK" }));
    } else if (name === "ping-unhealthy" || name === "ping-error") {
      const failed = name === "ping-error";
      res.writeHead(failed ? 503 : 200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          failed ? { message: "unavailable" } : { status: "UNHEALTHY" },
        ),
      );
    } else if (name === "ping-redirect") {
      res
        .writeHead(302, {
          Location: "/team/chat/api/v4/system/ping?check=ping-destination",
        })
        .end();
    } else if (name === "bytes") {
      assert.equal(req.headers["x-fixture"], "café");
      res.setHeader("X-Fixture", "café");
      res.setHeader("Set-Cookie", "fixture=one; Path=/");
      res.setHeader("Set-Cookie2", "fixture=two");
      res.setHeader("ToKeN", ["fixture-secret-one", "fixture-secret-two"]);
      res.setHeader("Authorization", "Bearer fixture-secret");
      res.end(
        Buffer.from(Uint8Array.from({ length: 65_536 }, (_, i) => i % 251)),
      );
    } else if (name === "disconnect") {
      disconnect = req.socket;
      res.writeHead(200, { "Content-Length": "20" }).write("A");
    } else if (name === "redirect") {
      res
        .writeHead(302, {
          Location: "/team/chat/api/v4/system/ping?check=destination",
        })
        .end();
    } else if (["204", "205", "304", "401", "503"].includes(name)) {
      if (name === "401") {
        res.setHeader("ToKeN", "fixture-secret");
        res.setHeader("WWW-Authenticate", "Bearer");
      }
      res
        .writeHead(Number(name))
        .end(name === "401" || name === "503" ? "status body" : undefined);
    } else {
      res.writeHead(404).end();
    }
  });
  data.on("connection", () => {
    connections++;
  });
  const control = https.createServer(trusted, async (req, res) => {
    const url = new URL(req.url ?? "/", "https://localhost");
    assert.equal(url.pathname, "/api/v4/system/ping");
    const step = url.searchParams.get("step");
    if (step === "before") {
      assert.equal(
        connections,
        0,
        "prepared, cancelled and refused requests must not open a socket",
      );
      before = true;
    } else if (step === "thread-back") {
      assert(
        pressThreadBack,
        "expected a single Back event on the disposable Android device",
      );
      const press = pressThreadBack;
      pressThreadBack = undefined;
      await press();
      visits.push("android-thread-back");
    } else if (step === "release-history") {
      refresh.release();
    } else if (step === "release-submission") {
      submissions.release();
    } else if (step === "disconnect") {
      assert(disconnect);
      disconnect.destroy();
    } else {
      const name = url.searchParams.get("case") ?? "";
      const wait = held.get(name);
      assert(wait);
      assert(step === "received" || step === "closed");
      await wait[step];
      if (name === "reload" && step === "closed" && prepareKeyboard) {
        const sendTab = prepareKeyboard;
        prepareKeyboard = undefined;
        // Hold the fixture response until the input reaches the reloaded Activity.
        await sendTab();
      }
    }
    res.writeHead(204).end();
  });
  let untrustedRequests = 0;
  const foreign = https.createServer(untrusted, (_req, res) => {
    untrustedRequests++;
    res.end();
  });
  return {
    servers: [data, control, foreign],
    onAndroidInputReady(send: SendAndroidKey) {
      prepareKeyboard = () => send("KEYCODE_TAB");
      pressThreadBack = () => send("KEYCODE_BACK");
    },
    verify(platform: "macos" | "android") {
      refresh.verify();
      assert.equal(
        offlineHistoryRequests,
        1,
        "only the online control may reach the offline fixture",
      );
      assert(before);
      assert.equal(settings.size, 2);
      assert.equal(entrySettings.size, 2);
      assert.equal(untrustedRequests, 0);
      const expected = [
        "signed-single-channel",
        "managed-category-mappings",
        "bytes",
        "204",
        "205",
        "304",
        "401",
        "503",
        "redirect",
        "disconnect",
        "headers",
        "body",
        "owner",
        "reload",
        "ping-root",
        "user-me",
        "user-profile",
        "profiles-by-name",
        "profile-image",
        "account-logout-confirmed",
        "account-logout-unconfirmed",
        "account-first",
        "account-second",
        "account-denied",
        "account-expired",
        "workspace-config",
        "workspace-license",
        "account-html",
        "account-large",
        "account-truncated",
        "account-error-body",
        "account-retire",
        "my-teams",
        "my-team-members",
        "directory-teams",
        "my-team-members",
        "sidebar-preferences",
        "team-channels",
        "directory-channels",
        "directory-channel-members",
        "directory-channels",
        "directory-channel-members",
        "sidebar-categories",
        "sidebar-categories",
        "team-memberships",
        "sidebar-categories",
        "sidebar-preferences",
        "create-post-root",
        "submit-root",
        "submit-refused",
        "submit-corrected",
        "submit-unknown",
        "submit-unknown-retry",
        "submit-wrong-author",
        "submit-expired",
        "create-post-reply",
        "save-post-reaction",
        "delete-post-reaction",
        "custom-emoji-by-name",
        "custom-emoji-by-name",
        "custom-emoji-by-name",
        "empty-post-reactions",
        "post-reactions",
        "read-thread",
        "read-team-threads",
        "follow-thread",
        "unfollow-thread",
        "collapse-sidebar-category",
        "remove-sidebar-category",
        "thread-list-page",
        "thread-list-totals",
        "thread-list-empty",
        "account-thread-page",
        "account-thread-empty",
        "account-thread-totals",
        "patch-post",
        "post-edit-history",
        "post-edit-history",
        "signed-patch-post",
        "delete-post",
        "bulk-channel-view",
        "single-channel-view",
        "clear-channel-view",
        "signed-slash-command",
        "saved-slash-command",
        "channel-stats",
        "channel-stats",
        "broadcast-timezones",
        "channel-timezones",
        "team-group-associations-all",
        "team-group-associations-empty",
        "channel-group-associations-all",
        "channel-group-associations-all",
        "channel-group-associations-empty",
        "group-directory-page",
        "group-directory-empty",
        "group-audience-empty",
        "group-audience-timezones",
        "group-audience-timezones",
        "member-notifications",
        "own-team-join",
        "own-team-leave",
        "member-add",
        "member-remove",
        "member-self",
        "member-id",
        "members-page",
        "members-batch",
        "account-role-owner",
        "saved-role-definitions",
        "role-definitions",
        "absent-roles",
        "set-post-unread",
        "history-root",
        "history-prefixed",
        "history-focused-after",
        "history-focused-before",
        "history-anonymous",
        "saved-room-history",
        "single-file-info",
        "single-file-info",
        "single-file-info",
        "single-file-retention",
        "post-file-infos",
        "single-post-reply",
        "single-post-reply",
        "single-post-reply",
        "single-post-retention",
        "post-info-root",
        "post-info-prefixed",
        "post-info-prefixed",
        "post-thread-archive",
        "post-thread-reply",
        "batch-signed",
        "batch-anonymous",
        "batch-text",
        "batch-headers",
        "batch-body",
        "ping-prefix",
        "ping-prefix",
        "ping-unhealthy",
        "ping-error",
        "ping-redirect",
        "ping-headers",
        "ping-body",
      ];
      if (platform === "macos") expected.push("window");
      if (platform === "android") expected.push("account-logout-local-failure");
      expected.push(
        "directory-teams",
        "my-team-members",
        "sidebar-preferences",
      );
      if (platform === "android")
        expected.push(
          "browser-action-confirmed",
          "browser-action-confirmed",
          "browser-action-confirmed",
          "browser-action-confirmed",
          "live-roles",
          "live-roles",
          "browser-entry-unconfirmed",
          "browser-entry-unconfirmed",
          "live-config/client",
          "live-license/client",
          "live-channels",
          "live-members",
          "live-categories",
          "live-channels",
          "live-members",
          "live-categories",
          "live-window-send",
          "live-window-thread",
          "android-thread-back",
          "live-window-thread",
          "live-window-send-reply",
          "live-window-command-repeat",
          "browser-action-confirmed",
          "live-search-posts",
          "live-search-files",
          "browser-action-confirmed",
          "live-search-posts",
          "live-posts-" + "c".repeat(26),
          "live-posts-" + "d".repeat(26),
          "live-posts-" + "d".repeat(26),
          "live-authors",
          "live-authors",
          "browser-entry-config/client",
          "browser-entry-license/client",
          ...[
            "config/client",
            "license/client",
            "users/me/teams",
            "users/me/teams/members",
            "users/me/preferences",
          ].map((path) => "browser-entry-" + path),
        );
      assert.deepEqual(visits.sort(), expected.sort());
    },
  };
}
