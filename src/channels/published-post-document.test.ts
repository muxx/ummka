import { afterEach, expect, test, vi } from "vitest";
import * as markdown from "../mattermost/post-markdown-lexer.ts";
import { composerPostMentions } from "./composer-mentions.ts";
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

test("retains only the outer destination for an image description", () => {
  const message =
    "![a \\* b and \\&copy;](https://example.test/escaped) " +
    "![**bold** ~~old~~ and `literal &amp;` ![inner](https://example.test/nested) [&#128;](https://example.test/link)](https://example.test/outer)";
  expect(doc(message)).toEqual([
    paragraph(
      {
        kind: "imageDescription",
        text: "a * b and &copy;",
        target: { kind: "web", href: "https://example.test/escaped" },
      },
      text(" "),
      {
        kind: "imageDescription",
        text: "bold old and literal &amp; inner €",
        target: { kind: "web", href: "https://example.test/outer" },
      },
    ),
  ]);
});

test("preserves reference destinations, image descriptions and the author’s automatic link label", () => {
  const body =
    "[**guide**][ref] ![sky &amp; sea](https://images.example.test/file) ![](https://images.example.test/empty)\ncustom://room https://example.test/a?x=1&amp;y=2\n\n[ref]: https://example.test/hidden";
  expect(doc(body)).toEqual([
    paragraph(
      {
        kind: "linkLabel",
        target: { kind: "web", href: "https://example.test/hidden" },
        children: [{ kind: "strong", children: [text("guide")] }],
      },
      text(" "),
      {
        kind: "imageDescription",
        text: "sky & sea",
        target: { kind: "web", href: "https://images.example.test/file" },
      },
      text(" "),
      {
        kind: "imageDescription",
        text: "",
        target: { kind: "web", href: "https://images.example.test/empty" },
      },
      { kind: "lineBreak" },
      text("custom://room "),
      {
        kind: "linkLabel",
        target: { kind: "web", href: "https://example.test/a?x=1&y=2" },
        children: [text("https://example.test/a?x=1&amp;y=2")],
      },
    ),
  ]);
});

test("keeps HTML literal and preserves an escaped pipe and neighboring prose", () => {
  const table = "|a|b|\n|-|-|\n|x|y\\| |\n\n";
  const source =
    'Inline <small title="a &amp; b">name</small>\n\n<div class="note">&amp;</div>\n\n' +
    table +
    "After";
  expect(doc(source)).toEqual([
    paragraph(text('Inline <small title="a &amp; b">name</small>')),
    { kind: "literal", text: '<div class="note">&amp;</div>' },
    {
      kind: "table",
      align: [null, null],
      header: [[text("a")], [text("b")]],
      rows: [[[text("x")], [text("y|")]]],
    },
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

test.each([
  [
    "[here](/chat/team/pl/post?x=1&amp;y=2#reply)",
    "sitePath",
    "/chat/team/pl/post?x=1&y=2#reply",
    "here",
  ],
  ["<a@example.test>", "mail", "mailto:a@example.test", "a@example.test"],
  ["www.example.test", "web", "http://www.example.test/", "www.example.test"],
  [
    "[a](HTTPS://EXAMPLE.TEST/путь%2Fu?note=&amp;amp;#x)",
    "web",
    "https://example.test/%D0%BF%D1%83%D1%82%D1%8C%2Fu?note=&amp;#x",
    "a",
  ],
  [
    "[write](mailto:a@example.test?subject=Release)",
    "mail",
    "mailto:a@example.test?subject=Release",
    "write",
  ],
])("retains the destination and label of %s", (source, kind, href, label) => {
  expect(doc(source)).toEqual([
    paragraph({
      kind: "linkLabel",
      target: { kind, href },
      children: [text(label)],
    }),
  ]);
});

test.each([
  "java&#x73;cript:run",
  "data:text/plain,hi",
  "custom://room",
  "file:///tmp/map",
  "https://user:pass@host.test/x",
  "https://@host.test/a",
  "//host.test/x",
  "https:///extra.test",
  "room/name",
  "http:/host.test",
  "https://[bad",
  "https://host.test/a&#10;b",
  "/&#92;host.test/path",
  "mailto://host.test",
  "mailto:/notes",
  "",
])("keeps the readable label for a rejected destination %s", (href) => {
  expect(doc(`[**read**](${href})`)).toEqual([
    paragraph({
      kind: "linkLabel",
      target: null,
      children: [{ kind: "strong", children: [text("read")] }],
    }),
  ]);
});

test("a linked image, even inside emphasis, has only the outer destination", () => {
  expect(
    doc("[**![map](https://img.test/map)**](/chat/team/channels/maps)"),
  ).toEqual([
    paragraph({
      kind: "linkLabel",
      target: { kind: "sitePath", href: "/chat/team/channels/maps" },
      children: [
        {
          kind: "strong",
          children: [{ kind: "imageDescription", text: "map", target: null }],
        },
      ],
    }),
  ]);
});

test("preserves extra and short rows, empty cells, inline content and optional alignment", () => {
  const source = [
    "| Name | Result | Score |",
    "| :--- | :---: | ---: |",
    "| [*Aurora*](https://example.test) | | `17` | extra **value** |",
    "| short |",
    "| literal <small>text</small> | escaped \\| here | ![polar](https://example.test/p) |",
  ].join("\n");
  expect(doc(source)).toEqual([
    {
      kind: "table",
      align: ["left", "center", "right"],
      header: [[text("Name")], [text("Result")], [text("Score")]],
      rows: [
        [
          [
            {
              kind: "linkLabel",
              target: { kind: "web", href: "https://example.test/" },
              children: [{ kind: "emphasis", children: [text("Aurora")] }],
            },
          ],
          [],
          [{ kind: "code", text: "17" }],
          [text("extra "), { kind: "strong", children: [text("value")] }],
        ],
        [[text("short")]],
        [
          [text("literal <small>text</small>")],
          [text("escaped | here")],
          [
            {
              kind: "imageDescription",
              text: "polar",
              target: { kind: "web", href: "https://example.test/p" },
            },
          ],
        ],
      ],
    },
  ]);
});

test("keeps authored headings when the delimiter row is shorter, and accepts an empty body", () => {
  expect(doc("| a | b |\n| :- |\n| x | y |")).toEqual([
    {
      kind: "table",
      align: ["left"],
      header: [[text("a")], [text("b")]],
      rows: [[[text("x")], [text("y")]]],
    },
  ]);
  expect(doc("| a |\n| - |")).toEqual([
    { kind: "table", align: [null], header: [[text("a")]], rows: [] },
  ]);
  expect(doc("Title\n---")[0]).toMatchObject({ kind: "heading", level: 2 });
  expect(doc("~~~\n| a | b |\n| - | - |\n~~~")[0]).toMatchObject({
    kind: "codeBlock",
  });
});

test("distinguishes escaped and structural pipes in a long row without changing following prose", () => {
  const long = "x".repeat(15_000);
  const source = [
    "| Name | Version |",
    "| :- | -: |",
    "| Service\\\\| `1\\|2` | " + long + " \\||",
    "",
    "After",
  ].join("\n");
  expect(doc(source)).toEqual([
    {
      kind: "table",
      align: ["left", "right"],
      header: [[text("Name")], [text("Version")]],
      rows: [
        [
          [text("Service\\")],
          [{ kind: "code", text: "1|2" }],
          [text(`${long} |`)],
        ],
      ],
    },
    paragraph(text("After")),
  ]);
});
