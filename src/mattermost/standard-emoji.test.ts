import { expect, test } from "vitest";
import { findStandardEmoji } from "./standard-emoji.ts";

test("exact aliases share a glyph while the caller retains the spelling from the post", () => {
  const primary = findStandardEmoji("+1");
  expect(primary).toEqual({ primaryName: "+1", glyph: "👍" });
  expect(findStandardEmoji("thumbsup")).toBe(primary);
  expect(findStandardEmoji("Thumbsup")).toBeUndefined();
});

test("preserves compound Unicode and names that exceed the server's reaction length", () => {
  expect(
    findStandardEmoji("crossed_fingers_medium_light_skin_tone")?.glyph,
  ).toBe("🤞🏼");
  expect(
    findStandardEmoji(
      "hand_with_index_and_middle_fingers_crossed_medium_light_skin_tone",
    )?.primaryName,
  ).toBe("crossed_fingers_medium_light_skin_tone");
  expect(
    findStandardEmoji(
      "man_and_woman_holding_hands_light_skin_tone_medium_light_skin_tone",
    )?.glyph,
  ).toContain("\u200d");
});

test("distinguishes the built-in Mattermost sign from unknown names", () => {
  expect(findStandardEmoji("mattermost")).toEqual({
    primaryName: "mattermost",
    glyph: null,
  });
  for (const name of [
    "",
    "unknown-to-the-standard-list",
    "constructor",
    "__proto__",
    "toString",
  ])
    expect(findStandardEmoji(name)).toBeUndefined();
});
