import { Lexer } from "marked";

export function lexPostMarkdown(message: string) {
  return Lexer.lex(message, { gfm: true });
}
