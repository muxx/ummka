import { Lexer, type Token } from "marked";

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
      else pieces.push(token.text.replace(/:[a-zA-Z0-9_+-]+:/g, " "));
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

export function composerMentions(message: string): ComposerMentions {
  if (message.startsWith("/") || !message.includes("@"))
    return { channel: [], groupCandidates: [] };
  const channel = new Set<ChannelMention>();
  const groupCandidates = new Set<string>();
  const text = mentionableText(Lexer.lex(message, { gfm: true }));
  // Mattermost permits dots, hyphens and underscores inside a handle. Trailing punctuation
  // after a reserved mention is prose; a real group handle must be resolved against the directory.
  for (const match of text.matchAll(/(?:\B|\b_+)@([a-z0-9._-]+)/gi)) {
    const handle = match[1].toLowerCase();
    const name = handle.replace(/[._-]+$/, "");
    if (name === "all" || name === "channel" || name === "here")
      channel.add(`@${name}`);
    else if (name) groupCandidates.add(handle);
  }
  return { channel: [...channel], groupCandidates: [...groupCandidates] };
}
