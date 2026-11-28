import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { parseChannelsLink } from "../../src/mattermost/channels-link.ts";
import { readNamedChannelDestination } from "../../src/mattermost/named-channel-destination.ts";
import { readPostDestination } from "../../src/mattermost/post-destination.ts";
import { Configuration, PostsApi } from "../../vendor/mattermost/index.js";
import {
  postLinks,
  systemReply as reply,
  systemRoot as root,
} from "../webview-check/link-examples.ts";
import { respondToAccount } from "./account.ts";
import { respondToWorkspace } from "./workspace.ts";

test("the compact subscription read belongs to the accepted thread reply", async (t) => {
  const visits: string[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "", "http://localhost");
    try {
      const visit = await respondToWorkspace(req, res, url, "", false, {
        acceptedThreadReply: visits.includes("live-window-send-reply"),
      });
      assert(visit);
      visits.push(visit);
    } catch (error) {
      assert(error instanceof assert.AssertionError);
      res.writeHead(400).end();
    }
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/browser-action-check/api/v4/`;
  const headers = { Authorization: "Bearer fixture-browser-action" };
  const thread = (query: string) =>
    fetch(base + "posts/" + root + "/thread?" + query, { headers });
  const query = "collapsedThreads=true&direction=down&perPage=";
  const post = (reply: boolean) =>
    fetch(base + "posts", {
      method: "POST",
      headers,
      body: JSON.stringify({
        channel_id: "c".repeat(26),
        message: reply
          ? "Posted from the thread window"
          : "Posted from the channel window",
        ...(reply && { root_id: root }),
        pending_post_id: "f".repeat(26) + ":submitted",
      }),
    });

  assert.equal((await thread(query + "60")).status, 200);
  assert.equal((await thread(query + "1")).status, 400);
  assert.equal((await post(false)).status, 201);
  assert.equal((await thread(query + "1")).status, 400);
  assert.equal((await post(true)).status, 201);
  const result = await thread(query + "1");
  assert.equal(result.status, 200);
  const page = await result.json();
  assert.equal(page.posts[root].is_following, true);
  assert.equal(page.order.length, 2);
  assert.equal(page.has_next, true);
  for (const wrong of [
    query + "2",
    query + "1&fromPost=" + root,
    query + "5&perPage=1",
    query + "1&skipFetchThreads=false",
    "collapsedThreads=true&direction=up&perPage=1",
  ])
    assert.equal((await thread(wrong)).status, 400);
  assert.deepEqual(visits, [
    "live-window-thread",
    "live-window-send",
    "live-window-send-reply",
    "live-window-follow-source",
  ]);
});

test("the native system-link fixture binds the signed named channel and its exact reply", async (t) => {
  const visits: string[] = [];
  const userId = "f".repeat(26);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "", "http://localhost");
    try {
      const visit =
        (await respondToWorkspace(req, res, url, userId, false, {
          systemLinks: true,
        })) ??
        respondToAccount(req, res, url, userId, () => {}, {
          browserToken: "fixture-system-post",
        });
      assert(visit);
      visits.push(visit);
    } catch (error) {
      assert(error instanceof assert.AssertionError);
      res.writeHead(400).end();
    }
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  const { port } = server.address() as AddressInfo;
  const links = postLinks(port);
  const cold = parseChannelsLink(links.server, links.cold);
  assert(cold?.kind === "permalink");
  assert.equal(cold.postId, root);
  const warm = parseChannelsLink(links.server, links.warmNamedReply);
  assert(warm?.kind === "conversation" && warm.route === "channels");
  assert.equal(warm.postId, reply);

  const basePath = `http://127.0.0.1:${port}/browser-action-check`;
  const api = new Configuration({
    basePath,
    accessToken: "fixture-system-post",
  });
  const named = await readNamedChannelDestination(
    api,
    userId,
    warm.team,
    warm.identifier,
  );
  assert.equal(named.kind, "channel");
  assert.equal(named.channel.membership, "member");
  const posts = new PostsApi(api);
  const destination = await readPostDestination(posts, reply);
  assert.equal(destination.team?.id, named.team.id);
  assert.equal(destination.team?.joined, true);
  assert.equal(destination.channel.id, named.channel.id);
  assert.equal(destination.channel.joined, true);
  const post = await posts.getPost({ postId: reply });
  assert.equal(post.id, reply);
  assert.equal(post.rootId, root);
  assert.equal(post.channelId, named.channel.id);
  assert.match(post.message ?? "", /Open published root/u);
  assert.deepEqual(visits, [
    "system-named-team",
    "browser-entry-users/me/teams/members",
    "system-named-channel",
    "live-members",
    "system-reply-destination",
    "system-reply-anchor",
  ]);

  const nameRoute = `${basePath}/api/v4/teams/name/browser`;
  const refusedHeaders: HeadersInit[] = [
    {},
    { Authorization: "Bearer fixture-browser-action" },
    { Authorization: "Bearer fixture-system-post", Cookie: "session=wrong" },
  ];
  for (const headers of refusedHeaders)
    assert.equal((await fetch(nameRoute, { headers })).status, 400);
});
