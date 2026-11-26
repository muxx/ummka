import { expect, test } from "vitest";
import { publishedPostDocument } from "./published-post-document.ts";
import { publishedPostExcerpt } from "./published-post-excerpt.ts";

function excerpt(message: string) {
  return publishedPostExcerpt(publishedPostDocument({ message }));
}

test("preserves inline words while separating blocks, list items and breaks", () => {
  const message = [
    "# Sh**ip**ped",
    "",
    "> A  ",
    "> B",
    "> C",
    "",
    "- [x] Pack",
    "  - Inner",
    "  - Next",
    "- [ ] Verify",
    "",
    "---",
    "",
    "Finish\t\t here",
  ].join("\n");
  expect(excerpt(message)).toBe(
    "Shipped A B C Pack Inner Next Verify Finish here",
  );
});

test("reads link labels and image descriptions without exposing their targets", () => {
  const message = [
    "[Release **notes**](https://example.test/private) and ![Map &amp; legend](https://example.test/image)",
    "![](https://example.test/empty) <https://example.test/:wave:/>",
  ].join("\n");
  expect(excerpt(message)).toBe(
    "Release notes and Map & legend https://example.test/:wave:/",
  );
});

test("renders code and unsupported blocks literally, decodes parsed text only once", () => {
  const doc = publishedPostDocument({
    message: [
      "Use `&amp;` and &amp;amp;.",
      "",
      "```md",
      "**raw**",
      "<tag>",
      "```",
      "",
      "<aside>literal</aside>",
      "",
      "| a | b |",
      "|---|---|",
      "| c | d |",
    ].join("\n"),
  });
  const before = structuredClone(doc);
  expect(publishedPostExcerpt(doc)).toBe(
    "Use &amp; and &amp;. **raw** <tag> <aside>literal</aside> | a | b | |---|---| | c | d |",
  );
  expect(doc).toEqual(before);
});

test("retains full graphemes, emoji names, and every character of a long post", () => {
  const message = `${"z".repeat(99)}🧑🏽‍💻 :wave: :custom_fox: 🇫🇮`;
  expect(excerpt(message)).toBe(message);
});

test.each(["", "  \n ", "---", "![](https://example.test/image)"])(
  "returns an empty excerpt for content without readable words (%s)",
  (message) => expect(excerpt(message)).toBe(""),
);
