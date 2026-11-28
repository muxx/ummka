import { expect, test } from "vitest";
import { PostFromJSON } from "../../vendor/mattermost/index.js";
import { receivedIntegrationCards } from "./integration-cards.ts";

const embed = { type: "message_attachment" };

test("observation depends on the embed coverage, including when attachments were cleared", () => {
  const props = { attachments: [{ title: "Verification" }] };
  const withoutEmbed = PostFromJSON({
    message: "",
    type: "slack_attachment",
    props,
    metadata: {},
  });
  expect(receivedIntegrationCards(withoutEmbed, "partial")).toBeUndefined();
  expect(receivedIntegrationCards(withoutEmbed, "complete")).toEqual([]);

  const withEmbed = PostFromJSON({
    message: "Build complete",
    type: "",
    props,
    metadata: { embeds: [embed] },
  });
  expect(receivedIntegrationCards(withEmbed, "partial")).toEqual([
    { title: "Verification", fields: [] },
  ]);
  for (const attachments of [[], null, undefined, "invalid"]) {
    expect(
      receivedIntegrationCards(
        { ...withEmbed, props: { attachments } },
        "complete",
      ),
    ).toEqual([]);
  }
  const linkFirst = PostFromJSON({
    props,
    metadata: { embeds: [{ type: "link" }, embed] },
  });
  expect(receivedIntegrationCards(linkFirst, "complete")).toEqual([]);
});

test("invalid optional data stays local and only matching image metadata is copied", () => {
  const body =
    "  **Build ready**\n\n[Report](https://example.test/build?a=1&b=2)\n";
  const icon = "https://assets.example.test/icon.png";
  const image = "https://assets.example.test/image.png";
  const thumb = "https://assets.example.test/thumb.png";
  const decoded = PostFromJSON({
    props: {
      attachments: [
        null,
        {
          title: "Report",
          title_link: 1,
          text: body,
          author_icon: icon,
          image_url: image,
          thumb_url: thumb,
          footer_icon: "__proto__",
          fields: [
            { title: "Phase", value: "`tests`", short: true },
            ["malformed"],
            { title: "Failures", value: 0, short: "true" },
            { title: "Pending", value: { secret: "field secret" } },
            { value: "Title is optional" },
          ],
          actions: [
            {
              integration: { url: "private URL", context: "private context" },
              cookie: "private cookie",
            },
          ],
          unknown: "unknown value",
        },
        { fallback: "Excerpt source", fields: { malformed: true } },
      ],
    },
    metadata: {
      embeds: [embed],
      images: {
        [icon]: { width: 4, height: 3, format: "png", frame_count: 0 },
        [image]: { width: "4", height: 3 },
        [thumb]: { width: 20, height: 10, format: [], frame_count: -1 },
        unrelated: { width: 8, height: 6, format: "png" },
      },
    },
  });
  const cards = receivedIntegrationCards(decoded, "complete");
  expect(cards).toEqual([
    {
      title: "Report",
      text: body,
      fields: [
        { title: "Phase", value: "`tests`", short: true },
        { title: "Failures", value: "0", short: false },
        { title: "Pending", short: false },
        { value: "Title is optional", short: false },
      ],
      authorIcon: {
        url: icon,
        metadata: { width: 4, height: 3, format: "png", frameCount: 0 },
      },
      image: { url: image },
      thumbnail: { url: thumb, metadata: { width: 20, height: 10 } },
      footerIcon: { url: "__proto__" },
    },
    { fallback: "Excerpt source", fields: [] },
  ]);
  expect(JSON.stringify(cards)).not.toMatch(
    /private|unknown value|field secret|unrelated/u,
  );
});
