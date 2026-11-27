import { Lexer, Tokenizer, type Tokens } from "marked";

// Mattermost preserves authored cells beyond the header. Marked's default table
// tokenizer discards those cells before exposing tokens to the application.
function cells(row: string) {
  const result: string[] = [];
  let start = 0;
  let slashes = 0;
  const append = (end: number) => {
    result.push(row.slice(start, end).trim().replace(/\\\|/gu, "|"));
  };
  for (let i = 0; i < row.length; i++) {
    if (row[i] === "\\") {
      slashes++;
      continue;
    }
    if (row[i] === "|" && slashes % 2 === 0) {
      if (start > 0 || row.slice(0, i).trim()) append(i);
      start = i + 1;
    }
    slashes = 0;
  }
  if (start === 0 || row.slice(start).trim()) append(row.length);
  return result;
}

function alignment(delimiter: string): Tokens.TableCell["align"] {
  if (delimiter.startsWith(":"))
    return delimiter.endsWith(":") ? "center" : "left";
  return delimiter.endsWith(":") ? "right" : null;
}

class PostTokenizer extends Tokenizer {
  override table(source: string): Tokens.Table | undefined {
    const header = this.rules.other.tableHeader.exec(source);
    if (!header || !this.rules.other.tableDelimiter.test(header[2])) return;
    const match = this.rules.block.table.exec(source);
    if (!match) return;
    const align = cells(header[2]).map(alignment);
    const tokenizeRow = (line: string, header: boolean) =>
      cells(line).map((text, index) => ({
        text,
        tokens: this.lexer.inline(text),
        header,
        align: align[index] ?? null,
      }));
    let end = match[0].length;
    while (end > 0 && match[0][end - 1] === "\n") end--;
    const body = match[3]?.replace(this.rules.other.tableRowBlankLine, "");
    return {
      type: "table",
      raw: match[0].slice(0, end),
      align,
      header: tokenizeRow(header[1], true),
      rows: body?.trim()
        ? body.split("\n").map((line) => tokenizeRow(line, false))
        : [],
    };
  }
}

export function lexPostMarkdown(message: string) {
  return Lexer.lex(message, { gfm: true, tokenizer: new PostTokenizer() });
}
