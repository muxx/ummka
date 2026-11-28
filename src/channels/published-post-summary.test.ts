import { expect, test } from "vitest";
import type { IntegrationCard } from "../mattermost/integration-cards.ts";
import {
  integrationCardBody,
  publishedPostSummary,
} from "./published-post-summary.ts";

function card(fields: Partial<IntegrationCard>): IntegrationCard {
  return { fields: [], ...fields };
}

test("uses authored text before the ordered card excerpt", () => {
  const cards = [
    card({ title: "  macOS\n  build  ", text: "Not part of this excerpt" }),
    card({ title: " ", text: "  \n" }),
    card({ text: "**Android** passed\n\nRun complete." }),
  ];
  expect(publishedPostSummary({ message: "**Release** status", cards })).toBe(
    "Release status",
  );
  expect(publishedPostSummary({ message: "", cards })).toBe(
    "macOS build Android passed Run complete.",
  );
});

test.each(["", " \t\n ", "[reference]: https://example.test"])(
  "uses the card or permits a file excerpt when the message has no visible blocks (%j)",
  (message) => {
    expect(
      publishedPostSummary({ message, cards: [card({ title: "Release" })] }),
    ).toBe("Release");
    expect(publishedPostSummary({ message })).toBeUndefined();
  },
);

test("keeps authored text when Markdown combines definitions with visible content", () => {
  const message =
    "[reference]: https://example.test\n\n**Release** [report][reference]";
  const cards = [card({ title: "Fallback card" })];
  expect(publishedPostSummary({ message, cards })).toBe("Release report");
});

test.each(["---", "![](https://example.test/image.png)", "```\n```"])(
  "retains the precedence of a visible block without text (%j)",
  (message) => {
    expect(
      publishedPostSummary({
        message,
        cards: [card({ title: "Fallback card" })],
      }),
    ).toBe("");
  },
);

test("ignores empty definitions and fields outside the published card presentation", () => {
  const empty = card({
    title: "  ",
    text: "[reference]: https://example.test",
    fallback: "Server fallback",
    footer: "Private footer",
  });
  expect(integrationCardBody(empty).visible).toBe(false);
  expect(
    publishedPostSummary({ cards: [empty, card({ text: "  \n" })] }),
  ).toBeUndefined();
  expect(publishedPostSummary({ cards: [] })).toBeUndefined();
});

test("preserves visible Markdown structure and parses an unchanged card once", () => {
  const withRule = card({ text: "---" });
  const contents = integrationCardBody(withRule);
  expect(contents).toEqual({
    blocks: [{ kind: "rule" }],
    excerpt: "",
    visible: true,
  });
  expect(integrationCardBody(withRule)).toBe(contents);
  expect(
    publishedPostSummary({ cards: [card({ text: "    literal code" })] }),
  ).toBe("literal code");
});
