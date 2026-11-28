import type { EntryLanguage } from "../entry/language.ts";
import type { ReceivedResultPost } from "../mattermost/received-result-post.ts";
import { attachmentExcerpt } from "./post-attachment-cards.ts";
import { publishedPostSummary } from "./published-post-summary.ts";
import { positiveSearchWords } from "./search-conditions.ts";

export function searchResultPatterns(terms: string) {
  const query = literalPattern(positiveSearchWords(terms));
  const quoted = /"[^"]*"/u.test(terms);
  return {
    file: query,
    post: (matches: readonly string[] | undefined) =>
      matches === undefined || quoted ? query : literalPattern(matches),
  };
}

function literalPattern(words: readonly string[]) {
  const terms = [
    ...new Set(
      words
        .map((word) => word.trim().replace(/\*$/u, "").replace(/\s+/gu, " "))
        .filter(Boolean),
    ),
  ];
  if (!terms.length) return null;
  terms.sort((a, b) => b.length - a.length);
  return new RegExp(
    terms.map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|"),
    "giu",
  );
}

export function searchPostFragment(
  row: ReceivedResultPost,
  pattern: RegExp | null,
  language: EntryLanguage,
) {
  const text =
    publishedPostSummary({
      message: typeof row.message === "string" ? row.message : undefined,
      cards: row.cards,
    }) ?? attachmentExcerpt(row.attachments, language);
  const first = pattern ? text.search(pattern) : -1;
  const from = first < 40 ? 0 : first - 30;
  const start = codePointBoundary(text, from);
  const end = codePointBoundary(text, Math.min(text.length, start + 180));
  const parts = markedText(text, pattern, start, end);
  if (start) parts.unshift({ text: "…", start: -1, match: false });
  if (end < text.length) parts.push({ text: "…", start: end, match: false });
  return parts;
}

// A compact excerpt can cut between characters. Keep surrogate pairs intact.
function codePointBoundary(text: string, index: number) {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff ? index - 1 : index;
}

export function markedText(
  text: string,
  pattern: RegExp | null,
  start = 0,
  end = text.length,
) {
  const parts: { text: string; start: number; match: boolean }[] = [];
  let at = start;
  if (pattern) {
    for (const hit of text.matchAll(pattern)) {
      if (hit.index >= end) break;
      const left = Math.max(hit.index, start);
      const right = Math.min(hit.index + hit[0].length, end);
      if (right <= left) continue;
      if (left > at)
        parts.push({ text: text.slice(at, left), start: at, match: false });
      parts.push({ text: text.slice(left, right), start: left, match: true });
      at = right;
    }
  }
  if (at < end)
    parts.push({ text: text.slice(at, end), start: at, match: false });
  return parts;
}
