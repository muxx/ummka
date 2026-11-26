import { describe, expect, it, vi } from "vitest";
import { PostFromJSON } from "../../vendor/mattermost/index.js";
import { channelPostChange } from "./channel-post-records.ts";
import { readPostAnchor } from "./message-anchors.ts";

const channelId = "c".repeat(26);
const postId = "p".repeat(26);
const a = "a".repeat(26);
const b = "b".repeat(26);
const base = {
  id: postId,
  channel_id: channelId,
  user_id: "u".repeat(26),
  root_id: "",
  create_at: 10,
  update_at: 10,
  edit_at: 0,
  delete_at: 0,
  type: "",
  message: "",
  is_pinned: false,
  hashtags: "",
};
function published(fields: Record<string, unknown>) {
  const decoded = PostFromJSON({ ...base, ...fields });
  const row = channelPostChange(channelId, postId, decoded);
  if (row.kind !== "save") throw Error("Expected the published row");
  return { decoded, row };
}

describe("attachment observations of a received post", () => {
  it("preserves independent server order and copies only visible details", () => {
    const { decoded, row } = published({
      file_ids: [b, a],
      metadata: {
        files: [
          {
            id: a,
            post_id: postId,
            channel_id: channelId,
            name: "same.md",
            size: 0,
            extension: "md",
            mime_type: "text/markdown",
            width: 0,
            height: 0,
            has_preview_image: false,
            archived: false,
            path: "private",
          },
          { id: b, name: "same.md" },
        ],
      },
    });
    expect(row.attachments).toStrictEqual({
      fileIds: [b, a],
      files: [
        {
          id: a,
          name: "same.md",
          size: 0,
          extension: "md",
          mimeType: "text/markdown",
          width: 0,
          height: 0,
          hasPreviewImage: false,
          archived: false,
        },
        { id: b, name: "same.md" },
      ],
    });
    decoded.fileIds?.reverse();
    decoded.metadata?.files?.reverse();
    const first = decoded.metadata?.files?.[0];
    if (!first) throw Error("Missing test file");
    first.name = "changed";
    expect(row.attachments?.fileIds).toEqual([b, a]);
    expect(row.attachments?.files?.map((file) => file.name)).toEqual([
      "same.md",
      "same.md",
    ]);
  });

  it("distinguishes missing, empty, ID-only, partial descriptions and a redaction", () => {
    expect(published({ filenames: ["old.txt"] }).row).not.toHaveProperty(
      "attachments",
    );
    expect(published({ metadata: {} }).row).not.toHaveProperty("attachments");
    for (const [fields, value] of [
      [{ file_ids: [] }, { fileIds: [] }],
      [{ metadata: { files: [] } }, { files: [] }],
      [
        { file_ids: [b, a], metadata: { files: [] } },
        { fileIds: [b, a], files: [] },
      ],
      [
        { file_ids: [a, b], metadata: { files: [{ id: b }] } },
        { fileIds: [a, b], files: [{ id: b }] },
      ],
      [
        { metadata: { files: [{ id: a, post_id: "", channel_id: "" }] } },
        { files: [{ id: a }] },
      ],
      [
        { file_ids: [], metadata: { redacted_file_count: 2 } },
        { fileIds: [], redactedFileCount: 2 },
      ],
      [{ metadata: { redacted_file_count: 0 } }, { redactedFileCount: 0 }],
    ] as const)
      expect(published(fields).row.attachments).toStrictEqual(value);
  });

  it("rejects malformed IDs, contradictory redaction, foreign scope and bad metadata fields", () => {
    for (const broken of [
      { file_ids: [""] },
      { file_ids: [a, a] },
      { metadata: { files: [{ id: a }, { id: a }] } },
      { metadata: { redacted_file_count: -1 } },
      { metadata: { redacted_file_count: 1.5 } },
      { file_ids: [a], metadata: { redacted_file_count: 1 } },
      { metadata: { redacted_file_count: 1, files: [{ id: a }] } },
      ...[
        { id: "bad" },
        { id: a, post_id: b },
        { id: a, channel_id: b },
        { id: a, size: -1 },
        { id: a, height: 1.5 },
        { id: a, archived: 0 },
        { id: a, name: false },
      ].map((file) => ({ metadata: { files: [file] } })),
    ])
      expect(() => published(broken)).toThrow(TypeError);
  });

  it("replaces a readable anchor with only its redaction, then its deletion or refusal", async () => {
    const getPost = vi
      .fn()
      .mockResolvedValueOnce(
        PostFromJSON({
          ...base,
          file_ids: [a],
          metadata: { files: [{ id: a, name: "seen.md" }] },
        }),
      )
      .mockResolvedValueOnce(
        PostFromJSON({
          ...base,
          file_ids: [],
          metadata: { redacted_file_count: 2 },
        }),
      )
      .mockResolvedValueOnce(
        PostFromJSON({
          ...base,
          delete_at: 20,
          file_ids: [a],
          metadata: { files: [{ id: b, post_id: a }] },
        }),
      );
    expect(
      (await readPostAnchor({ getPost }, postId)).post?.attachments?.files?.[0]
        ?.name,
    ).toBe("seen.md");
    expect(
      (await readPostAnchor({ getPost }, postId)).post?.attachments,
    ).toStrictEqual({ fileIds: [], redactedFileCount: 2 });
    expect((await readPostAnchor({ getPost }, postId)).post).toBeNull();
    const denied = Error("Forbidden");
    getPost.mockRejectedValueOnce(denied);
    await expect(readPostAnchor({ getPost }, postId)).rejects.toBe(denied);
  });
});
