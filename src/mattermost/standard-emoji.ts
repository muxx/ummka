import directory from "../../vendor/emoji/standard.json" with { type: "json" };

type StandardEmoji = {
  readonly primaryName: string;
  readonly glyph: string | null;
};

let byName: Map<string, StandardEmoji> | undefined;

export function findStandardEmoji(name: string): StandardEmoji | undefined {
  if (!byName) {
    byName = new Map();
    for (const [glyph, ...names] of directory.rows) {
      const record = { primaryName: names[0], glyph: glyph || null };
      for (const alias of names) byName.set(alias, record);
    }
  }
  return byName.get(name);
}
