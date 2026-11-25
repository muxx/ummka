import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

async function directory(path: string) {
  const source: unknown = JSON.parse(await readFile(path, "utf8"));
  assert.ok(Array.isArray(source), "Expected the Mattermost emoji directory.");
  const seen = new Set<string>();
  return source.map(({ short_name: name, short_names: aliases, unified }) => {
    assert.ok(
      Array.isArray(aliases) && aliases.length > 0 && aliases[0] === name,
    );
    for (const alias of aliases) {
      assert.ok(
        typeof alias === "string" && alias.length > 0 && !seen.has(alias),
        "Missing or duplicate standard emoji alias.",
      );
      seen.add(alias);
    }
    assert.ok(
      typeof unified === "string" &&
        (unified === "" || /^[\dA-F]{4,6}(?:-[\dA-F]{4,6})*$/u.test(unified)),
      "Invalid emoji Unicode sequence.",
    );
    const glyph = unified
      ? String.fromCodePoint(
          ...unified
            .split("-")
            .map((part: string) => Number.parseInt(part, 16)),
        )
      : "";
    return [glyph, ...aliases];
  });
}

const [baseline, compatible, target] = process.argv.slice(2);
const rows = await directory(baseline);
assert.deepEqual(
  await directory(compatible),
  rows,
  "Review the standard emoji directory for both supported Mattermost versions.",
);
const notice =
  "Adapted by ummka from Mattermost Channels and emoji-datasource. See public/licenses/standard-emoji.txt.";
// Keep one record per line for review when updating either source.
await writeFile(
  target,
  [
    "{",
    `  "notice": ${JSON.stringify(notice)},`,
    '  "rows": [',
    rows.map((row) => "    " + JSON.stringify(row)).join(",\n"),
    "  ]",
    "}",
    "",
  ].join("\n"),
);
