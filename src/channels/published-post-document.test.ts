import { afterEach, expect, test, vi } from "vitest";
import { composerPostMentions } from "./composer-mentions.ts";
import * as markdown from "./post-markdown-lexer.ts";
import { publishedPostDocument } from "./published-post-document.ts";

const text = (value: string) => ({ kind: "text", text: value });
const paragraph = (...children: unknown[]) => ({ kind: "paragraph", children });
const doc = (message: string) => publishedPostDocument({ message });
afterEach(() => vi.restoreAllMocks());

test("uses the published display string, including empty, without touching its edit source", () => {
  for (const message of ["", "Shown 🐻‍❄️"]) {
    const post = Object.freeze({
      message,
      get messageSource(): string {
        throw Error("The edit source is private to editing");
      },
    });
    expect(publishedPostDocument(post)).toEqual(
      message ? [paragraph(text(message))] : [],
    );
  }
});

test("combines escaped Markdown and character references as text, preserving code and explicit and soft lines", () => {
  expect(
    doc(
      "\\*é\\* &amp; &copy; &#x1F43B;\nsecond  \r\nthird\\\n`&lt;code&gt;`\n\n~~old~~ and **_new_**",
    ),
  ).toEqual([
    paragraph(
      text("*é* & © 🐻"),
      { kind: "lineBreak" },
      text("second"),
      { kind: "lineBreak" },
      text("third"),
      { kind: "lineBreak" },
      { kind: "code", text: "&lt;code&gt;" },
    ),
    paragraph({ kind: "strike", children: [text("old")] }, text(" and "), {
      kind: "strong",
      children: [{ kind: "emphasis", children: [text("new")] }],
    }),
  ]);
});

test("preserves block hierarchy, list numbering, tasks and the distinct code blocks", () => {
  const source =
    "#### Header\n\n> 3. one\n>    - [x] done\n>    - [ ] next\n> 4. two\n\n---\n\n~~~ts info\nA < B && C\n~~~\n\n    &amp; indented";
  expect(doc(source)).toEqual([
    { kind: "heading", level: 4, children: [text("Header")] },
    {
      kind: "quote",
      blocks: [
        {
          kind: "list",
          start: 3,
          loose: false,
          items: [
            {
              checked: null,
              blocks: [
                paragraph(text("one")),
                {
                  kind: "list",
                  start: null,
                  loose: false,
                  items: [
                    { checked: true, blocks: [paragraph(text("done"))] },
                    { checked: false, blocks: [paragraph(text("next"))] },
                  ],
                },
              ],
            },
            { checked: null, blocks: [paragraph(text("two"))] },
          ],
        },
      ],
    },
    { kind: "rule" },
    { kind: "codeBlock", language: "ts", text: "A < B && C" },
    { kind: "codeBlock", language: null, text: "&amp; indented" },
  ]);
  expect(doc("0. a\n\n1. b")[0]).toMatchObject({
    kind: "list",
    start: 0,
    loose: true,
  });
});

test("decodes each complete character reference once, including HTML replacement code points", () => {
  expect(doc("&#128; &#x80; &#0; &#38;amp; &amp;amp;")).toEqual([
    paragraph(text("€ € � &amp; &amp;")),
  ]);
});

test("flattens formatted image descriptions to their visible text without link destinations", () => {
  const message =
    "![a \\* b and \\&copy;](https://example.test/escaped) " +
    "![**bold** ~~old~~ and `literal &amp;` ![inner](https://example.test/nested) [&#128;](https://example.test/link)](https://example.test/outer)";
  expect(doc(message)).toEqual([
    paragraph(
      { kind: "imageDescription", text: "a * b and &copy;" },
      text(" "),
      { kind: "imageDescription", text: "bold old and literal &amp; inner €" },
    ),
  ]);
});

test("exposes only formatted link labels and image descriptions; automatic addresses stay visible text", () => {
  const body =
    "[**guide**][ref] ![sky &amp; sea](https://images.example.test/file) ![](https://images.example.test/empty)\ncustom://room https://example.test/a?x=1&amp;y=2\n\n[ref]: https://example.test/hidden";
  expect(doc(body)).toEqual([
    paragraph(
      {
        kind: "linkLabel",
        children: [{ kind: "strong", children: [text("guide")] }],
      },
      text(" "),
      { kind: "imageDescription", text: "sky & sea" },
      text(" "),
      { kind: "imageDescription", text: "" },
      { kind: "lineBreak" },
      text("custom://room https://example.test/a?x=1&amp;y=2"),
    ),
  ]);
});

test("renders HTML and the version-sensitive table as literal source, preserving neighboring prose", () => {
  const table = "|a|b|\n|-|-|\n|x|y\\| |\n\n";
  const source =
    'Inline <small title="a &amp; b">name</small>\n\n<div class="note">&amp;</div>\n\n' +
    table +
    "After";
  expect(doc(source)).toEqual([
    paragraph(text('Inline <small title="a &amp; b">name</small>')),
    { kind: "literal", text: '<div class="note">&amp;</div>' },
    { kind: "literal", text: table.trimEnd() },
    paragraph(text("After")),
  ]);
});

test.each(["code", "pre", "script", "kbd"])(
  "preserves entity spelling inside a raw HTML %s span and decodes adjacent prose",
  (tag) => {
    const literal = `<${tag}>&amp; &#38;amp; &copy;</${tag}>`;
    expect(doc(`&copy; before ${literal} after &copy;`)).toEqual([
      paragraph(text(`© before ${literal} after ©`)),
    ]);
  },
);

test("preserves the entire raw source of unfamiliar block and inline tokens", () => {
  const tokens = markdown.lexPostMarkdown("before\n\nafter");
  const first = tokens[0];
  if (first?.type !== "paragraph" || !first.tokens)
    throw Error("unexpected fixture");
  first.tokens.push({ type: "future_inline", raw: "::future[&amp;]" });
  tokens.splice(1, 0, { type: "future_block", raw: ":::card\nbody\n:::" });
  vi.spyOn(markdown, "lexPostMarkdown").mockReturnValueOnce(tokens);
  expect(doc("probe")).toEqual([
    paragraph(text("before::future[&amp;]")),
    { kind: "literal", text: ":::card\nbody\n:::" },
    paragraph(text("after")),
  ]);
});

test("lexes once per projection and skips parsing outgoing text without a mention candidate", () => {
  const lex = vi.spyOn(markdown, "lexPostMarkdown");
  expect(composerPostMentions("**ordinary** post")).toEqual({
    channel: [],
    groupCandidates: [],
  });
  expect(lex).not.toHaveBeenCalled();
  const message = "**@here**";
  composerPostMentions(message);
  expect(lex).toHaveBeenCalledExactlyOnceWith(message);
  lex.mockClear();
  doc(message);
  expect(lex).toHaveBeenCalledExactlyOnceWith(message);
});
