import { decodeHTMLStrict } from "entities/decode";
import type { MarkedToken, Token, Tokens } from "marked";
import { lexPostMarkdown } from "../mattermost/post-markdown-lexer.ts";

import { publishedLinkTarget } from "./published-link-target.ts";

type Destination = ReturnType<typeof publishedLinkTarget>;
type Inline =
  | { kind: "text" | "code" | "emojiText"; text: string }
  | { kind: "imageDescription"; text: string; target: Destination }
  | { kind: "linkLabel"; children: Inline[]; target: Destination }
  | { kind: "lineBreak" }
  | {
      kind: "emphasis" | "strong" | "strike";
      children: Inline[];
    };

type Block =
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "codeBlock"; language: string | null; text: string }
  | { kind: "rule" }
  | { kind: "literal"; text: string }
  | {
      kind: "table";
      align: ("left" | "center" | "right" | null)[];
      header: Inline[][];
      rows: Inline[][][];
    }
  | {
      kind: "list";
      start: number | null;
      loose: boolean;
      items: { checked: boolean | null; blocks: Block[] }[];
    };

// WebApp 12 applies ASCII word boundaries to each Markdown text token.
export const publishedEmojiPattern = /(?<!\w):([\w+-]+):(?!\w)/gu;

const emphasisKinds = {
  strong: "strong",
  em: "emphasis",
  del: "strike",
} as const;

function appendText(nodes: Inline[], text: string) {
  if (!text) return;
  const previous = nodes.at(-1);
  if (previous?.kind === "text") previous.text += text;
  else nodes.push({ kind: "text", text });
}

function plainText(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      if ("children" in node) return plainText(node.children);
      return node.kind === "lineBreak" ? "\n" : node.text;
    })
    .join("");
}

type InlineOptions = { inlineEmoji?: boolean; insideLink?: boolean };

// Marked also types optional extension nodes. Our shared lexer uses only its built-in grammar.
function inline(tokens: Token[], options: InlineOptions): Inline[] {
  const { inlineEmoji, insideLink } = options;
  const nodes: Inline[] = [];
  for (const token of tokens as MarkedToken[]) {
    switch (token.type) {
      case "text": {
        if (
          inlineEmoji &&
          !token.escaped &&
          token.raw.search(publishedEmojiPattern) >= 0
        ) {
          nodes.push({ kind: "emojiText", text: token.raw });
          break;
        }
        const text = token.escaped ? token.raw : decodeHTMLStrict(token.raw);
        for (const [i, line] of text.split("\n").entries()) {
          if (i > 0) nodes.push({ kind: "lineBreak" });
          appendText(nodes, line);
        }
        break;
      }
      case "escape":
        appendText(nodes, token.text);
        break;
      case "br":
        nodes.push({ kind: "lineBreak" });
        break;
      case "codespan":
        nodes.push({ kind: "code", text: token.text });
        break;
      case "strong":
      case "em":
      case "del": {
        nodes.push({
          kind: emphasisKinds[token.type],
          children: inline(token.tokens, options),
        });
        break;
      }
      case "link":
        nodes.push({
          kind: "linkLabel",
          target: insideLink ? null : publishedLinkTarget(token.href),
          children: token.autolink
            ? [{ kind: "text", text: token.text }]
            : inline(token.tokens, { inlineEmoji, insideLink: true }),
        });
        break;
      case "image":
        nodes.push({
          kind: "imageDescription",
          target: insideLink ? null : publishedLinkTarget(token.href),
          text: plainText(inline(token.tokens, { insideLink: true })),
        });
        break;
      case "checkbox":
        // Its list item already owns the checked state.
        break;
      default:
        // HTML and future lexer extensions are always author text.
        appendText(nodes, token.raw);
    }
  }
  return nodes;
}

function blocks(tokens: Token[], options: InlineOptions): Block[] {
  const nodes: Block[] = [];
  for (const token of tokens as MarkedToken[]) {
    switch (token.type) {
      case "paragraph":
      case "text":
        nodes.push({
          kind: "paragraph",
          children: inline(token.tokens ?? [token], options),
        });
        break;
      case "heading":
        nodes.push({
          kind: "heading",
          level: token.depth,
          children: inline(token.tokens, options),
        });
        break;
      case "blockquote":
        nodes.push({ kind: "quote", blocks: blocks(token.tokens, options) });
        break;
      case "hr":
        nodes.push({ kind: "rule" });
        break;
      case "code":
        nodes.push({
          kind: "codeBlock",
          language: token.lang?.split(/\s/u, 1)[0] || null,
          text: token.text,
        });
        break;
      case "table": {
        const row = (cells: Tokens.TableCell[]) =>
          cells.map((cell) => inline(cell.tokens, options));
        nodes.push({
          kind: "table",
          align: token.align,
          header: row(token.header),
          rows: token.rows.map(row),
        });
        break;
      }
      case "list":
        nodes.push({
          kind: "list",
          start: token.ordered ? Number(token.start) : null,
          loose: token.loose,
          items: token.items.map((item: Tokens.ListItem) => ({
            checked: item.checked ?? null,
            blocks: blocks(item.tokens, options),
          })),
        });
        break;
      case "space":
      case "def":
      case "checkbox":
        break;
      default:
        nodes.push({ kind: "literal", text: token.raw });
    }
  }
  return nodes;
}

/** Takes the displayed text of a published post, including an intentionally empty body. */
export function publishedPostDocument({
  message,
  inlineEmoji,
}: {
  message: string;
  inlineEmoji?: boolean;
}): Block[] {
  return blocks(lexPostMarkdown(message), { inlineEmoji });
}
