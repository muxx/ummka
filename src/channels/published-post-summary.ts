import type { CardExcerptSource } from "../mattermost/integration-cards.ts";
import { publishedPostDocument } from "./published-post-document.ts";
import { publishedPostExcerpt } from "./published-post-excerpt.ts";

type Document = ReturnType<typeof publishedPostDocument>;
type Inline = Extract<
  Document[number],
  { kind: "paragraph" }
>["children"][number];

function hasImage(node: Inline): boolean {
  return (
    node.kind === "imageDescription" ||
    ("children" in node && node.children.some(hasImage))
  );
}

function hasNonTextContent(block: Document[number]): boolean {
  if (block.kind === "quote") return block.blocks.some(hasNonTextContent);
  if ("children" in block) return block.children.some(hasImage);
  return (
    block.kind === "list" || block.kind === "rule" || block.kind === "table"
  );
}

const cardBodies = new WeakMap<
  CardExcerptSource,
  { blocks: Document; excerpt: string; visible: boolean }
>();

export function integrationCardTitle(card: CardExcerptSource) {
  return card.title?.trim() ?? "";
}

export function integrationCardBody(card: CardExcerptSource) {
  const cached = cardBodies.get(card);
  if (cached) return cached;
  const blocks = card.text ? publishedPostDocument({ message: card.text }) : [];
  const excerpt = publishedPostExcerpt(blocks);
  const body = {
    blocks,
    excerpt,
    visible: Boolean(excerpt) || blocks.some(hasNonTextContent),
  };
  cardBodies.set(card, body);
  return body;
}

export function publishedPostSummary({
  message,
  cards,
}: {
  message?: string;
  cards?: readonly CardExcerptSource[];
}) {
  if (message?.trim()) {
    const blocks = publishedPostDocument({ message });
    // A visible structure can take precedence without having a text excerpt.
    if (blocks.length) return publishedPostExcerpt(blocks);
  }
  const excerpt = cards
    ?.map(
      (card) => integrationCardTitle(card) || integrationCardBody(card).excerpt,
    )
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ");
  return excerpt || undefined;
}
