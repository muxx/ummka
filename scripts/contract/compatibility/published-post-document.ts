import assert from "node:assert/strict";
import { publishedPostDocument } from "../../../src/channels/published-post-document.ts";
import { publishedPostExcerpt } from "../../../src/channels/published-post-excerpt.ts";
import { channelHistoryPage } from "../../../src/mattermost/channel-history-page.ts";
import type { PostsApi } from "../../../vendor/mattermost/index.js";

export async function checkPublishedPostDocument(
  account: PostsApi,
  base: string,
  channelId: string,
  version: string,
) {
  const imageUrl = "https://example.test/image";
  const message = `# Release notes\n\n> **Ready** &amp; tested\n\n- [x] Read the [notes](https://example.test/notes)\n\nCost &#128; ![**price** \\&copy;](${imageUrl})`;
  const created = await account.createPost({
    createPostRequest: { channelId, message },
  });
  assert.ok(created.id);
  const request = { channelId, perPage: 20 };
  const page = channelHistoryPage(
    request,
    await account.getPostsForChannel(request),
  );
  assert.ok(page.order.includes(created.id));
  const row = page.changes.find((item) => item.id === created.id);
  assert.ok(row?.kind === "save");
  const proxy = new URL("/api/v4/image", base);
  proxy.searchParams.set("url", imageUrl);
  assert.equal(row.message, message.replace(imageUrl, proxy.href));
  assert.equal(row.messageSource, message);
  const document = publishedPostDocument(row);
  assert.deepEqual(document, [
    {
      kind: "heading",
      level: 1,
      children: [{ kind: "text", text: "Release notes" }],
    },
    {
      kind: "quote",
      blocks: [
        {
          kind: "paragraph",
          children: [
            { kind: "strong", children: [{ kind: "text", text: "Ready" }] },
            { kind: "text", text: " & tested" },
          ],
        },
      ],
    },
    {
      kind: "list",
      start: null,
      loose: false,
      items: [
        {
          checked: true,
          blocks: [
            {
              kind: "paragraph",
              children: [
                { kind: "text", text: "Read the " },
                {
                  kind: "linkLabel",
                  children: [{ kind: "text", text: "notes" }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      kind: "paragraph",
      children: [
        { kind: "text", text: "Cost € " },
        { kind: "imageDescription", text: "price &copy;" },
      ],
    },
  ]);
  assert.equal(
    publishedPostExcerpt(document),
    "Release notes Ready & tested Read the notes Cost € price &copy;",
  );
  console.log(
    `Mattermost ${version} returned the published Markdown post in channel history and preserved its document structure.`,
  );
}
