import {
  type Post,
  type PostMetadata,
  PostMetadataEmbedsInnerTypeEnum,
} from "../../vendor/mattermost/index.js";
import { isMattermostTime } from "./model-fields.ts";

type IntegrationCardField = Readonly<{
  title?: string;
  value?: string;
  short: boolean;
}>;

type IntegrationCardImage = Readonly<{
  url: string;
  metadata?: Readonly<{
    width: number;
    height: number;
    format?: string;
    frameCount?: number;
  }>;
}>;

type IntegrationCard = Readonly<{
  fallback?: string;
  color?: string;
  pretext?: string;
  authorName?: string;
  authorLink?: string;
  authorIcon?: IntegrationCardImage;
  title?: string;
  titleLink?: string;
  text?: string;
  fields: readonly IntegrationCardField[];
  image?: IntegrationCardImage;
  thumbnail?: IntegrationCardImage;
  footer?: string;
  footerIcon?: IntegrationCardImage;
}>;

type EmbedCoverage = "complete" | "partial";
const emptyCards: readonly IntegrationCard[] = Object.freeze([]);

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
}

function sourceText(value: unknown) {
  if (typeof value === "string" && value !== "") return value;
}

function cardFields(value: unknown): readonly IntegrationCardField[] {
  if (!Array.isArray(value)) return [];
  const fields: IntegrationCardField[] = [];
  for (const item of value) {
    const field = record(item);
    if (!field) continue;
    const title = sourceText(field.title);
    // Web clients stringify numeric values. Keep text in its authored form for Markdown.
    const text =
      typeof field.value === "number" && Number.isFinite(field.value)
        ? String(field.value)
        : sourceText(field.value);
    if (title !== undefined || text !== undefined)
      fields.push({ title, value: text, short: field.short === true });
  }
  return fields;
}

function cardImage(
  value: unknown,
  images: PostMetadata["images"],
): IntegrationCardImage | undefined {
  const url = sourceText(value);
  if (!url) return undefined;
  const image = images && Object.hasOwn(images, url) ? images[url] : undefined;
  if (!isMattermostTime(image?.width, 1) || !isMattermostTime(image?.height, 1))
    return { url };
  return {
    url,
    metadata: {
      width: image.width,
      height: image.height,
      format: sourceText(image.format),
      frameCount: isMattermostTime(image.frameCount, 0)
        ? image.frameCount
        : undefined,
    },
  };
}

/** A read without complete embed metadata can leave the card list unobserved. */
export function receivedIntegrationCards(
  post: Post,
  coverage: "complete",
): readonly IntegrationCard[];
export function receivedIntegrationCards(
  post: Post,
  coverage: EmbedCoverage,
): readonly IntegrationCard[] | undefined;
export function receivedIntegrationCards(post: Post, coverage: EmbedCoverage) {
  if (
    post.metadata?.embeds?.[0]?.type !==
    PostMetadataEmbedsInnerTypeEnum.MessageAttachment
  )
    return coverage === "complete" ? emptyCards : undefined;

  const attachments = record(post.props)?.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0)
    return emptyCards;

  const images = post.metadata.images;
  const cards: IntegrationCard[] = [];
  for (const item of attachments) {
    const card = record(item);
    if (!card) continue;
    cards.push({
      fallback: sourceText(card.fallback),
      color: sourceText(card.color),
      pretext: sourceText(card.pretext),
      authorName: sourceText(card.author_name),
      authorLink: sourceText(card.author_link),
      authorIcon: cardImage(card.author_icon, images),
      title: sourceText(card.title),
      titleLink: sourceText(card.title_link),
      text: sourceText(card.text),
      fields: cardFields(card.fields),
      image: cardImage(card.image_url, images),
      thumbnail: cardImage(card.thumb_url, images),
      footer: sourceText(card.footer),
      footerIcon: cardImage(card.footer_icon, images),
    });
  }
  return cards;
}

export function postWithIntegrationCards<T extends Post>(
  post: T,
): T & { readonly cards: readonly IntegrationCard[] } {
  return { ...post, cards: receivedIntegrationCards(post, "complete") };
}
