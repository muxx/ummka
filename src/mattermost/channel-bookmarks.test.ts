import { expect, test, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { readChannelBookmarks } from "./channel-bookmarks.ts";

const channel = "c".repeat(26),
  other = "x".repeat(26),
  fileId = "f".repeat(26);
const link = {
  id: "k".repeat(26),
  channel_id: channel,
  display_name: "Handbook",
  type: "link",
  link_url: "https://example.test/path",
  delete_at: 0,
};
const file = {
  id: "s".repeat(26),
  channel_id: channel,
  display_name: "Release build",
  type: "file",
  file_id: fileId,
  delete_at: 0,
};
const board = {
  ...link,
  id: "b".repeat(26),
  type: "board",
  target_id: other,
  link_url: "/boards/team/board",
};
const license = "api.channel.bookmark.channel_bookmark.license.error";
function fixture(response: Response) {
  const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(response);
  const config = new Configuration({
    basePath: "https://fixture.test/prefix",
    fetchApi,
  });
  return { config, fetchApi };
}

test("reads full bookmarks in server order and retains each typed destination", async () => {
  const restricted = { ...file, id: "r".repeat(26) };
  const { config, fetchApi } = fixture(
    Response.json([
      { ...board, sort_order: 7 },
      { ...restricted, sort_order: 7 },
      { ...link, sort_order: 1 },
      {
        ...file,
        file: { id: fileId, name: "release.zip", mime_type: "application/zip" },
      },
    ]),
  );
  const signal = new AbortController().signal;
  const result = await readChannelBookmarks(config, channel, signal);
  expect(fetchApi).toHaveBeenCalledExactlyOnceWith(
    `https://fixture.test/prefix/api/v4/channels/${channel}/bookmarks`,
    expect.objectContaining({ method: "GET", signal }),
  );
  expect(result).toEqual({
    kind: "available",
    bookmarks: [
      {
        id: board.id,
        name: "Handbook",
        destination: { kind: "board", targetId: other, path: board.link_url },
      },
      {
        id: restricted.id,
        name: "Release build",
        destination: {
          kind: "file",
          fileId,
          fileName: null,
          fileMimeType: null,
        },
      },
      {
        id: link.id,
        name: "Handbook",
        destination: { kind: "link", href: link.link_url },
      },
      {
        id: file.id,
        name: "Release build",
        destination: {
          kind: "file",
          fileId,
          fileName: "release.zip",
          fileMimeType: "application/zip",
        },
      },
    ],
  });
});

test("keeps an available empty channel distinct from a license refusal", async () => {
  expect(
    await readChannelBookmarks(fixture(Response.json([])).config, channel),
  ).toEqual({ kind: "available", bookmarks: [] });
  expect(
    await readChannelBookmarks(
      fixture(Response.json({ status_code: 501, id: license }, { status: 501 }))
        .config,
      channel,
    ),
  ).toEqual({ kind: "unlicensed" });
});

test.each([401, 403, 404, 500, 501])(
  "preserves an unrelated HTTP %i and its original body",
  async (status) => {
    const body = { id: "proxy_or_access_error", status_code: status };
    const { config } = fixture(Response.json(body, { status }));
    const error = await readChannelBookmarks(config, channel).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ResponseError);
    expect((error as ResponseError).response.status).toBe(status);
    expect(await (error as ResponseError).response.json()).toEqual(body);
  },
);

test.each([
  [link, link],
  [{ ...link, channel_id: other }],
  [{ ...link, delete_at: 1 }],
  [{ ...link, display_name: "" }],
  [{ ...link, link_url: "mailto:help@example.test" }],
  [{ ...file, file_id: "missing" }],
  [{ ...file, file: { id: other, name: "wrong" } }],
  [{ ...link, link_url: "https:example.test" }],
  [{ ...link, link_url: " https://example.test" }],
  [{ ...board, target_id: "" }],
  [{ ...board, link_url: "//example.test/board" }],
])("rejects invalid or out-of-scope full-list rows", async (...rows) => {
  await expect(
    readChannelBookmarks(fixture(Response.json(rows)).config, channel),
  ).rejects.toThrow(TypeError);
});

test("rejects invalid scopes and cancellations before publication", async () => {
  const { config, fetchApi } = fixture(Response.json([]));
  await expect(readChannelBookmarks(config, "bad")).rejects.toThrow(TypeError);
  const request = new AbortController();
  request.abort("closed");
  await expect(
    readChannelBookmarks(config, channel, request.signal),
  ).rejects.toBe("closed");
  expect(fetchApi).not.toHaveBeenCalled();
  const during = new AbortController();
  fetchApi.mockImplementationOnce(async () => {
    during.abort("superseded");
    return Response.json([]);
  });
  await expect(
    readChannelBookmarks(config, channel, during.signal),
  ).rejects.toBe("superseded");
});

test.each([undefined, null, ""])(
  "allows an accessible file without a media type (%s)",
  async (media) => {
    const { config, fetchApi } = fixture(
      Response.json([
        { ...file, file: { id: fileId, name: "notes.txt", mime_type: media } },
      ]),
    );
    const result = await readChannelBookmarks(config, channel);
    expect(result).toEqual({
      kind: "available",
      bookmarks: [
        {
          id: file.id,
          name: file.display_name,
          destination: {
            kind: "file",
            fileId,
            fileName: "notes.txt",
            fileMimeType: null,
          },
        },
      ],
    });
    expect(fetchApi).toHaveBeenCalledTimes(1);
  },
);
test.each([0, false, ["application/zip"], { value: "application/zip" }])(
  "rejects a non-string media type (%j) before publishing the list",
  async (media) => {
    const { config, fetchApi } = fixture(
      Response.json([
        {
          ...file,
          file: { id: fileId, name: "release.zip", mime_type: media },
        },
      ]),
    );
    await expect(readChannelBookmarks(config, channel)).rejects.toThrow(
      "Invalid Mattermost channel bookmark destination.",
    );
    expect(fetchApi).toHaveBeenCalledTimes(1);
  },
);
