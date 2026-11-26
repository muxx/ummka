import type { Token } from "marked";
import { lexPostMarkdown } from "./post-markdown-lexer.ts";

type ChannelMention = "@all" | "@channel" | "@here";
type ComposerMentions = {
  channel: ChannelMention[];
  groupCandidates: string[];
};

/** Adjacent text and escapes form words. Formatting boundaries separate them. */
function mentionableText(tokens: Token[]): string {
  const pieces: string[] = [];
  function visit(token: Token) {
    if (
      token.type === "text" ||
      token.type === "escape" ||
      token.type === "html"
    ) {
      if (token.type === "text" && token.tokens) token.tokens.forEach(visit);
      else pieces.push(token.text);
      return;
    }
    pieces.push(" ");
    if (token.type === "list") token.items.forEach(visit);
    else if (token.type === "table") {
      for (const row of [token.header, ...token.rows]) {
        for (const cell of row) {
          cell.tokens.forEach(visit);
          pieces.push(" ");
        }
      }
    } else if (
      "tokens" in token &&
      !(token.type === "link" && token.autolink)
    ) {
      token.tokens?.forEach(visit);
    }
    pieces.push(" ");
  }
  tokens.forEach(visit);
  return pieces.join("");
}

/** Only outgoing posts reach this scanner. A command explicitly sent as text is a post. */
export function composerPostMentions(message: string): ComposerMentions {
  if (!message.includes("@")) return { channel: [], groupCandidates: [] };
  const channel = new Set<ChannelMention>();
  const groupCandidates = new Set<string>();
  const text = mentionableText(lexPostMarkdown(message));
  // These are the word boundaries used by Mattermost's StandardMentionParser.
  for (const [word] of text.matchAll(/[\p{L}\p{N}@.:_-]+/gu)) {
    if (!word.includes("@") || (word.startsWith(":") && word.endsWith(":")))
      continue;
    const trimmed = word.replace(/^[:._-]+/, "");
    const candidates = trimmed.startsWith("@")
      ? [trimmed]
      : trimmed.split(/[.:-]/);
    for (const candidate of candidates) {
      if (!candidate.startsWith("@")) continue;
      const handle = candidate.slice(1).toLowerCase();
      const name = handle.replace(/[.:_-]+$/, "");
      if (name === "all" || name === "channel" || name === "here")
        channel.add(`@${name}`);
      else if (name) {
        // A colon can terminate a handle but cannot belong to a group name.
        const groupHandle = handle.replace(/:[.:_-]*$/, "");
        if (/^[a-z0-9._-]+$/.test(groupHandle))
          groupCandidates.add(groupHandle);
      }
    }
  }
  return { channel: [...channel], groupCandidates: [...groupCandidates] };
}
