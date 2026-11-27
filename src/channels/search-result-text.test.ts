import { expect, test } from "vitest";
import {
  markedText,
  searchPostFragment,
  searchResultPatterns,
} from "./search-result-text.ts";

function highlights(parts: ReturnType<typeof markedText>) {
  return parts.filter((part) => part.match).map((part) => part.text);
}

test("uses the specific post's matches and distinguishes a missing item from an empty list", () => {
  const { post } = searchResultPatterns("экран in:releases -черновик");
  const message = "Экрана хватило · черновик · релизы";
  expect(highlights(searchPostFragment(message, post(["экрана"])))).toEqual([
    "Экрана",
  ]);
  expect(highlights(searchPostFragment(message, post(undefined)))).toEqual([
    "Экран",
  ]);
  expect(highlights(searchPostFragment(message, post([])))).toEqual([]);
});

test("matches a positive quoted phrase through formatting and skips exclusions and filters", () => {
  const { post } = searchResultPatterns(
    'from:egor "quality gates" -"in progress" -draft in:"release notes"',
  );
  const message =
    "QUALITY **gates** · quality · in progress · draft · release notes · egor";
  expect(
    highlights(searchPostFragment(message, post(["quality", "draft"]))),
  ).toEqual(["QUALITY gates"]);
});

test("excludes every filter from a file name or a post fragment", () => {
  const { post, file } = searchResultPatterns(
    'in:"web app" -from:ann before:2026-11-18 ext:pdf -test',
  );
  expect(file).toBeNull();
  expect(post(undefined)).toBeNull();
  expect(highlights(markedText("ann-test.pdf", file))).toEqual([]);
});

test("preserves literal punctuation and Unicode case in file names", () => {
  const { file } = searchResultPatterns('"план + [A]" ext:pdf');
  expect(highlights(markedText("ПЛАН + [a] [plan].pdf", file))).toEqual([
    "ПЛАН + [a]",
  ]);
});

test("shows a bounded plain text fragment around the first visible match", () => {
  const { post } = searchResultPatterns("needle");
  const message =
    "[needle](https://example.test/hidden) " +
    "Сверяем макет. ".repeat(20) +
    " **NEEDLE** " +
    "тест проверки ".repeat(35);
  const hiddenLink = message
    .replace("[needle]", "[unrelated]")
    .replace("/hidden", "/needle");
  const parts = searchPostFragment(hiddenLink, post(undefined));
  const text = parts.map((part) => part.text).join("");
  expect(text.startsWith("…")).toBe(true);
  expect(text.endsWith("…")).toBe(true);
  expect(text.length).toBeLessThanOrEqual(182);
  expect(highlights(parts)).toEqual(["NEEDLE"]);
  expect(text).not.toMatch(/\*|https:/u);
});
