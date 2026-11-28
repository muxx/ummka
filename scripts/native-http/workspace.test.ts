import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { systemRoot as root } from "../webview-check/link-examples.ts";
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
