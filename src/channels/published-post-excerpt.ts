import type { publishedPostDocument } from "./published-post-document.ts";

type Block = ReturnType<typeof publishedPostDocument>[number];
type Inline = Extract<Block, { kind: "paragraph" }>["children"][number];

/** A single line of plain text for a published post that has already been parsed. */
export function publishedPostExcerpt(document: readonly Block[]): string {
  const parts: string[] = [];

  function readInline(node: Inline) {
    switch (node.kind) {
      case "text":
      case "code":
      case "imageDescription":
        parts.push(node.text);
        break;
      case "lineBreak":
        parts.push(" ");
        break;
      case "emphasis":
      case "strong":
      case "strike":
      case "linkLabel":
        node.children.forEach(readInline);
        break;
    }
  }

  function readBlock(block: Block) {
    switch (block.kind) {
      case "paragraph":
      case "heading":
        block.children.forEach(readInline);
        break;
      case "quote":
        block.blocks.forEach(readBlock);
        break;
      case "codeBlock":
      case "literal":
        parts.push(block.text);
        break;
      case "table":
        for (const row of [block.header, ...block.rows]) {
          for (const cell of row) {
            cell.forEach(readInline);
            parts.push(" ");
          }
        }
        break;
      case "list":
        for (const item of block.items) item.blocks.forEach(readBlock);
        break;
      case "rule":
        break;
    }
    parts.push(" ");
  }

  document.forEach(readBlock);
  return parts.join("").replace(/\s+/gu, " ").trim();
}
