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
