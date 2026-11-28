import { expect, test, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { accountBookmarkChanges } from "./account-bookmark-changes.ts";

const channel = "c".repeat(26);
const linkId = "b".repeat(26);
const otherId = "v".repeat(26);
const fileId = "f".repeat(26);
const userId = "u".repeat(26);
const otherUser = "o".repeat(26);
const href = "https://example.org/guide";
const storedImageUrl = "https://[fe80::1%25en0]/icon.png";
const link = {
  id: linkId,
  channel_id: channel,
  owner_id: userId,
  type: "link",
  display_name: "Guide",
  link_url: href,
  delete_at: 0,
  sort_order: 0,
};
const target = { id: linkId, destination: { kind: "link" as const, href } };
const file = {
  id: otherId,
  channel_id: channel,
  owner_id: userId,
  type: "file",
  display_name: "Guide.pdf",
  file_id: fileId,
  delete_at: 0,
  sort_order: 1,
};
const board = {
  ...link,
  id: otherId,
  type: "board",
  target_id: "t".repeat(26),
  link_url: "/boards/team/demo",
};
const deleted = { ...link, delete_at: 123 };
const replacement = {
  updated: { ...link, id: otherId, original_id: linkId },
  deleted: { ...deleted, owner_id: otherUser },
};
const draft = { type: "link" as const, displayName: "Guide", linkUrl: href };

function fixture(body: unknown, status = 200) {
  const send = vi.fn<typeof fetch>(async () =>
    body instanceof Response ? body : Response.json(body, { status }),
  );
  const config = new Configuration({
    basePath: "https://mm.example.test/prefix",
    fetchApi: send,
  });
  return {
    account: accountBookmarkChanges(config, userId, (run, signal) =>
      run(signal ?? new AbortController().signal),
    ),
    send,
  };
}

test("creates a link or file, keeping the decoration and restricted file information", async () => {
  const name = "🐻".repeat(64);
  const image = "https://example.org/image.png";
  const { account, send } = fixture(
    { ...link, display_name: name, emoji: "wave", image_url: image },
    201,
  );
  expect(
    await account.createChannelBookmark(channel, {
      ...draft,
      displayName: name,
      imageUrl: image,
      emoji: "wave",
    }),
  ).toEqual({
    ...target,
    name,
    emoji: "wave",
    imageUrl: image,
  });
  expect(send.mock.calls[0][0]).toBe(
    `https://mm.example.test/prefix/api/v4/channels/${channel}/bookmarks`,
  );
  expect(JSON.parse(String(send.mock.calls[0][1]?.body))).toEqual({
    type: "link",
    display_name: name,
    link_url: href,
    image_url: image,
    emoji: "wave",
  });
  const result = await fixture(file, 201).account.createChannelBookmark(
    channel,
    { type: "file", displayName: "Guide.pdf", fileId },
  );
  expect(result.destination).toEqual({
    kind: "file",
    fileId,
    fileName: null,
    fileMimeType: null,
  });
});

test("rejects a created bookmark with a foreign destination or channel", async () => {
  for (const row of [
    file,
    { ...link, link_url: "https://other.example.test" },
    { ...link, channel_id: otherId },
    { ...link, owner_id: otherUser },
  ]) {
    await expect(
      fixture(row, 201).account.createChannelBookmark(channel, draft),
    ).rejects.toThrow(TypeError);
  }
  await expect(
    fixture({ ...file, file_id: linkId }, 201).account.createChannelBookmark(
      channel,
      { type: "file", displayName: "Guide.pdf", fileId },
    ),
  ).rejects.toThrow(TypeError);
});

test("applies a partial edit and accepts the new ID together with the original tombstone", async () => {
  const { account, send } = fixture({ updated: link });
  expect(
    await account.updateChannelBookmark(channel, target, {
      imageUrl: "",
      emoji: "",
    }),
  ).toEqual({ updated: { ...target, name: "Guide" }, removedId: null });
  expect(JSON.parse(String(send.mock.calls[0][1]?.body))).toEqual({
    image_url: "",
    emoji: "",
  });
  const replaced = await fixture(replacement).account.updateChannelBookmark(
    channel,
    target,
    { displayName: "Guide" },
  );
  expect(replaced.updated.id).toBe(otherId);
  expect(replaced.removedId).toBe(linkId);
});

test.each([
  {},
  { updated: { ...link, id: otherId } },
  { updated: link, deleted },
  {
    updated: { ...link, id: otherId },
    deleted: { ...deleted, channel_id: otherId },
  },
  { updated: { ...link, id: otherId }, deleted: { ...deleted, id: otherId } },
  { updated: { ...link, id: otherId }, deleted: link },
  { updated: { ...link, channel_id: otherId } },
  { updated: { ...file, id: linkId } },
  { updated: { ...link, owner_id: otherUser } },
  { ...replacement, updated: { ...replacement.updated, original_id: otherId } },
  { ...replacement, deleted },
])("rejects ambiguous and out-of-scope edit confirmations", async (body) => {
  await expect(
    fixture(body).account.updateChannelBookmark(channel, target, {
      displayName: "Guide",
    }),
  ).rejects.toThrow(TypeError);
});

test("confirms deletion of the selected channel row and preserves denial evidence", async () => {
  expect(
    await fixture(deleted).account.deleteChannelBookmark(channel, target),
  ).toBe(linkId);
  for (const row of [
    link,
    { ...deleted, channel_id: otherId },
    { ...deleted, id: otherId },
    { ...deleted, type: "board" },
  ])
    await expect(
      fixture(row).account.deleteChannelBookmark(channel, target),
    ).rejects.toThrow(TypeError);
  for (const status of [401, 403, 404, 501]) {
    const body = { id: "fixture_code", status_code: status };
    const { account, send } = fixture(body, status);
    const failure = await account
      .deleteChannelBookmark(channel, target)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ResponseError);
    expect((failure as ResponseError).response.status).toBe(status);
    expect(await (failure as ResponseError).response.json()).toEqual(body);
    expect(send).toHaveBeenCalledTimes(1);
  }
});

test("accepts a board in the server order and rejects a response for the wrong move", async () => {
  const sorted = [
    { ...board, sort_order: 0 },
    { ...link, sort_order: 1 },
  ];
  const { account, send } = fixture(sorted);
  const rows = await account.moveChannelBookmark(channel, board.id, 0);
  expect(rows.map((row) => row.id)).toEqual([otherId, linkId]);
  expect(send.mock.calls[0][1]?.body).toBe("0");
  for (const bad of [
    sorted.slice().reverse(),
    [],
    [board, board],
    [{ ...board, sort_order: 3 }],
    [{ ...board, channel_id: otherId }],
  ]) {
    await expect(
      fixture(bad).account.moveChannelBookmark(channel, board.id, 0),
    ).rejects.toThrow(TypeError);
  }
});

test("preserves the stored image of another bookmark in the sort response", async () => {
  const { account } = fixture([
    { ...board, sort_order: 0 },
    { ...link, sort_order: 1, image_url: storedImageUrl },
  ]);
  await expect(
    account.moveChannelBookmark(channel, board.id, 0),
  ).resolves.toMatchObject([
    { id: board.id },
    { id: link.id, imageUrl: storedImageUrl },
  ]);
});

test.each([403, 501])(
  "preserves an HTTP %i sort refusal and its body",
  async (status) => {
    const body = { id: "fixture_sort_refusal", status_code: status };
    const { account, send } = fixture(body, status);
    const failure = await account
      .moveChannelBookmark(channel, board.id, 0)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ResponseError);
    expect((failure as ResponseError).response.status).toBe(status);
    expect(await (failure as ResponseError).response.json()).toEqual(body);
    expect(send).toHaveBeenCalledTimes(1);
  },
);

test("rejects invalid or empty changes, credentials and an already cancelled write before sending", async () => {
  const { account, send } = fixture(null);
  for (const linkUrl of [
    "https://user:pass@example.org",
    href + "x".repeat(1024),
    "mailto:help@example.org",
    "https://",
  ])
    await expect(
      account.createChannelBookmark(channel, { ...draft, linkUrl }),
    ).rejects.toThrow(TypeError);
  for (const changes of [
    {},
    { displayName: "" },
    { displayName: "🐻".repeat(65) },
    { fileId },
    { imageUrl: "https://user@example.org/icon" },
    { imageUrl: storedImageUrl },
    { displayName: "Revised", sortOrder: 0 },
  ])
    await expect(
      account.updateChannelBookmark(channel, target, changes),
    ).rejects.toThrow(TypeError);
  for (const position of [-1, 1.5, Infinity])
    await expect(
      account.moveChannelBookmark(channel, linkId, position),
    ).rejects.toThrow(TypeError);
  await expect(account.createChannelBookmark("short", draft)).rejects.toThrow(
    TypeError,
  );

  await expect(
    account.createChannelBookmark(channel, {
      type: "file",
      fileId: "bad",
      displayName: "File",
    }),
  ).rejects.toThrow(TypeError);
  const boardTarget = {
    id: board.id,
    destination: {
      kind: "board" as const,
      targetId: board.target_id,
      path: board.link_url,
    },
  };
  await expect(
    account.updateChannelBookmark(channel, boardTarget, {
      displayName: "Board",
    }),
  ).rejects.toThrow(TypeError);
  await expect(
    account.deleteChannelBookmark(channel, boardTarget),
  ).rejects.toThrow(TypeError);
  await expect(
    account.createChannelBookmark(channel, draft, AbortSignal.abort("closed")),
  ).rejects.toBe("closed");
  expect(send).not.toHaveBeenCalled();
});

test("requires the exact success status and requested change", async () => {
  await expect(
    fixture(link, 200).account.createChannelBookmark(channel, draft),
  ).rejects.toThrow("response status");
  await expect(
    fixture({ updated: link }).account.updateChannelBookmark(channel, target, {
      linkUrl: "https://example.org/other",
    }),
  ).rejects.toThrow("different bookmark change");
  await expect(
    fixture(deleted, 201).account.deleteChannelBookmark(channel, target),
  ).rejects.toThrow("response status");
  await expect(
    fixture([link], 201).account.moveChannelBookmark(channel, linkId, 0),
  ).rejects.toThrow("response status");
});

test("releases an unexpected success response without reading its body", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), {
    status: 202,
  });
  const { account } = fixture(response);
  await expect(account.createChannelBookmark(channel, draft)).rejects.toThrow(
    "response status",
  );
  expect(cancel).toHaveBeenCalledOnce();
});
