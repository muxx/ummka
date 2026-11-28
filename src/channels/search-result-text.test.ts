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
  expect(
    highlights(
      searchPostFragment({ message, cards: [] }, post(["экрана"]), "ru"),
    ),
  ).toEqual(["Экрана"]);
  expect(
    highlights(
      searchPostFragment({ message, cards: [] }, post(undefined), "ru"),
    ),
  ).toEqual(["Экран"]);
  expect(
    highlights(searchPostFragment({ message, cards: [] }, post([]), "ru")),
  ).toEqual([]);
});

test("matches a positive quoted phrase through formatting and skips exclusions and filters", () => {
  const { post } = searchResultPatterns(
    'from:egor "quality gates" -"in progress" -draft in:"release notes"',
  );
  const message =
    "QUALITY **gates** · quality · in progress · draft · release notes · egor";
  expect(
    highlights(
      searchPostFragment(
        { message, cards: [] },
        post(["quality", "draft"]),
        "en",
      ),
    ),
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
  const parts = searchPostFragment(
    { message: hiddenLink, cards: [] },
    post(undefined),
    "en",
  );
  const text = parts.map((part) => part.text).join("");
  expect(text.startsWith("…")).toBe(true);
  expect(text.endsWith("…")).toBe(true);
  expect(text.length).toBeLessThanOrEqual(182);
  expect(highlights(parts)).toEqual(["NEEDLE"]);
  expect(text).not.toMatch(/\*|https:/u);
});

test("uses the card title in a result without main text", () => {
  const cards = [{ title: "Release status", fields: [] }];
  expect(
    highlights(searchPostFragment({ message: "", cards }, /status/giu, "en")),
  ).toEqual(["status"]);
  expect(
    highlights(
      searchPostFragment({ message: "Main message", cards }, /status/giu, "en"),
    ),
  ).toEqual([]);
});

test("shows observed file names or their positions after invisible text and cards", () => {
  const one = "a".repeat(26),
    two = "b".repeat(26);
  const row = {
    message: "[note]: https://example.test",
    cards: [{ text: "   ", fields: [] }],
    attachments: {
      fileIds: [one, two],
      files: [{ id: two, name: "release-check.txt" }],
    },
  };
  const parts = searchPostFragment(row, /check/giu, "en");
  expect(parts.map((p) => p.text).join("")).toBe(
    "Attachment 1, release-check.txt",
  );
  expect(highlights(parts)).toEqual(["check"]);
  expect(searchPostFragment({ ...row, message: "---" }, null, "en")).toEqual(
    [],
  );
  expect(
    searchPostFragment(
      { ...row, attachments: { redactedFileCount: 2 } },
      null,
      "en",
    ),
  ).toEqual([]);
});
