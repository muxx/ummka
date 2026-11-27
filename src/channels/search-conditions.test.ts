import { expect, test } from "vitest";
import {
  changeSearchScope,
  removeSearchConditions,
  searchConditions,
} from "./search-conditions.ts";

test("finds Mattermost qualifiers at their real offsets and leaves literal text intact", () => {
  const raw =
    '"обзор  in:literal" from: "someone else" free In:#room -channel:old on:2026-11-17 ext:pdf -"some words"';
  const chips = searchConditions(raw);
  expect(
    chips.map(({ key, value, excluded }) => [key, value, excluded]),
  ).toEqual([
    ["from", "someone else", false],
    ["in", "#room", false],
    ["channel", "old", true],
    ["on", "2026-11-17", false],
    ["ext", "pdf", false],
    ["word", "some words", true],
  ]);
  expect(changeSearchScope(raw)).toEqual({
    terms: '"обзор  in:literal" free on:2026-11-17 ext:pdf -"some words"',
    removed: ['from: "someone else"', "In:#room", "-channel:old"],
  });
  const duplicate = "in:release alpha in:release beta";
  expect(
    removeSearchConditions(duplicate, [searchConditions(duplicate)[1]]),
  ).toBe("in:release alpha beta");
});
