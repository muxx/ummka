import assert from "node:assert/strict";
import { test } from "node:test";
import { createRestTransport } from "../../src/mattermost/rest-transport.ts";
import {
  BookmarksApi,
  ChannelBookmarkWithFileInfoToJSON,
  Configuration,
} from "../../vendor/mattermost/index.js";
import { listen } from "./test-server.ts";

test("reads a complete bookmark list and updates since a timestamp under a server prefix", async (t) => {
  const channelId = "c".repeat(26);
  const path = `/chat/api/v4/channels/${channelId}/bookmarks`;
  const urls: string[] = [];
  const rows = [
    {
      id: "link",
      type: "link",
      display_name: "Handbook",
      link_url: "https://example.org/guide",
      sort_order: 0,
    },
    {
      id: "file",
      type: "file",
      file_id: "f",
      file: { id: "f", name: "guide.pdf" },
      sort_order: 1,
    },
    { id: "restricted", type: "file", file_id: "r", sort_order: 2 },
    { id: "board", type: "board", target_id: "b".repeat(26), sort_order: 3 },
  ];
  const responses = [rows, [{ id: "link", delete_at: 345 }], []];
  const { base } = await listen(t, (req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.headers.authorization, "Bearer fixture");
    urls.push(req.url ?? "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(responses.shift()));
  });
  const api = new BookmarksApi(
    new Configuration({
      ...createRestTransport(`${base}/chat`, fetch),
      accessToken: "fixture",
    }),
  );
  const list = await api.listChannelBookmarksForChannelRaw({ channelId });
  assert.equal(list.raw.status, 200);
  const bookmarks = await list.value();
  assert.deepEqual(
    bookmarks.map(({ id, type, sortOrder }) => [id, type, sortOrder]),
    [
      ["link", "link", 0],
      ["file", "file", 1],
      ["restricted", "file", 2],
      ["board", "board", 3],
    ],
  );
  assert.equal(bookmarks[0].linkUrl, rows[0].link_url);
  assert.equal(bookmarks[0].displayName, "Handbook");
  assert.equal(bookmarks[1].file?.name, "guide.pdf");
  assert.equal(bookmarks[2].fileId, "r");
  assert.equal(bookmarks[2].file, undefined);
  assert.equal(bookmarks[3].targetId, rows[3].target_id);
  assert.equal(bookmarks[0].targetId, undefined);
  assert.deepEqual(
    JSON.parse(JSON.stringify(ChannelBookmarkWithFileInfoToJSON(bookmarks[3]))),
    rows[3],
  );
  const changes = await api.listChannelBookmarksForChannel({
    channelId,
    bookmarksSince: 123,
  });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].deleteAt, 345);
  assert.deepEqual(await api.listChannelBookmarksForChannel({ channelId }), []);
  assert.deepEqual(urls, [path, `${path}?bookmarks_since=123`, path]);
});

test("writes channel bookmarks through the generated client under the installation prefix", async (t) => {
  const channelId = "c".repeat(26);
  const bookmarkId = "b".repeat(26);
  const replacementId = "r".repeat(26);
  const fileId = "f".repeat(26);
  const path = `/chat/api/v4/channels/${channelId}/bookmarks`;
  const item = `${path}/${bookmarkId}`;
  const replacement = `${path}/${replacementId}`;
  const connectionId = "fixture-connection";
  const link = {
    display_name: "Guide",
    type: "link",
    link_url: "https://example.org/guide",
  };
  const file = { display_name: "Notes", type: "file", file_id: fileId };
  const updated = { ...link, id: replacementId, sort_order: 0 };
  const deleted = { ...link, id: bookmarkId, delete_at: 123 };
  const fileRow = { ...file, id: "n".repeat(26) };
  const responses = [
    { ...link, id: bookmarkId },
    fileRow,
    { updated, deleted },
    [updated, { ...fileRow, sort_order: 1 }],
    { ...updated, delete_at: 124 },
  ];
  const requests: unknown[] = [];
  const { base } = await listen(t, async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    requests.push([
      req.method,
      req.url,
      req.headers["connection-id"],
      body ? JSON.parse(body) : undefined,
    ]);
    res.writeHead(req.method === "POST" && req.url === path ? 201 : 200, {
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify(responses.shift()));
  });
  const api = new BookmarksApi(
    new Configuration(createRestTransport(`${base}/chat`, fetch)),
  );
  const created = await api.createChannelBookmarkRaw({
    channelId,
    connectionId,
    createChannelBookmarkRequest: {
      type: "link",
      linkUrl: link.link_url,
      displayName: link.display_name,
    },
  });
  assert.equal(created.raw.status, 201);
  assert.equal((await created.value()).id, bookmarkId);
  assert.equal(
    (
      await api.createChannelBookmark({
        channelId,
        createChannelBookmarkRequest: {
          type: "file",
          fileId,
          displayName: file.display_name,
        },
      })
    ).fileId,
    fileId,
  );
  const edit = await api.updateChannelBookmark({
    channelId,
    bookmarkId,
    connectionId,
    updateChannelBookmarkRequest: { emoji: "" },
  });
  assert.equal(edit.updated?.id, replacementId);
  assert.equal(edit.deleted?.deleteAt, 123);
  const nextTarget = { channelId, bookmarkId: replacementId, connectionId };
  const sorted = await api.updateChannelBookmarkSortOrder({
    ...nextTarget,
    body: 0,
  });
  assert.deepEqual(
    sorted.map((row) => row.sortOrder),
    [0, 1],
  );
  const removed = await api.deleteChannelBookmark(nextTarget);
  assert.equal(removed.id, replacementId);
  assert.equal(removed.deleteAt, 124);
  assert.deepEqual(requests, [
    ["POST", path, connectionId, link],
    ["POST", path, undefined, file],
    ["PATCH", item, connectionId, { emoji: "" }],
    ["POST", `${replacement}/sort_order`, connectionId, 0],
    ["DELETE", replacement, connectionId, undefined],
  ]);
});
