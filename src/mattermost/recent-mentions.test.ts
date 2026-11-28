// @vitest-environment node
import { expect, test, vi } from "vitest";
import { Configuration } from "../../vendor/mattermost/index.js";
import { openRecentMentions } from "./recent-mentions.ts";

const userId = "u".repeat(26);
function setup(
  id = userId,
  mentionKeys = "aurora,@all,@night-owl",
  firstName = "Alex",
) {
  const fetchApi = vi.fn<typeof fetch>(async () =>
    Response.json({
      id,
      username: "night-owl",
      first_name: firstName,
      notify_props: {
        mention_keys: mentionKeys,
        channel: "false",
        first_name: "true",
      },
      timezone: {
        useAutomaticTimezone: "false",
        manualTimezone: "Asia/Kathmandu",
      },
    }),
  );
  const readPostSearchPage = vi.fn().mockResolvedValue({
    items: [],
    isEnd: true,
    firstInaccessiblePostTime: 0,
  });
  return {
    config: new Configuration({ basePath: "https://example.test", fetchApi }),
    search: { readPostSearchPage },
    fetchApi,
  };
}
test("captures the signed profile once and reuses the terms, zone and scope on subsequent pages", async () => {
  const { config, search, fetchApi } = setup();
  const mentions = await openRecentMentions(config, userId, search, true);
  const signal = new AbortController().signal;
  await mentions.readPage(0);
  await mentions.readPage(1, signal);
  expect(fetchApi).toHaveBeenCalledTimes(1);
  expect(search.readPostSearchPage).toHaveBeenLastCalledWith(
    {
      page: 1,
      teamId: null,
      terms: '"@night-owl" "aurora" "Alex"',
      includeDeletedChannels: true,
      isOrSearch: true,
      timeZoneOffsetSeconds: 20700,
    },
    signal,
  );
});
test("rejects an unexpected profile or an aborted opening without starting a search", async () => {
  const { config, search, fetchApi } = setup("x".repeat(26));
  await expect(
    openRecentMentions(config, userId, search, false, AbortSignal.abort()),
  ).rejects.toThrow();
  expect(fetchApi).not.toHaveBeenCalled();
  await expect(
    openRecentMentions(config, userId, search, false),
  ).rejects.toThrow("owner");
  expect(search.readPostSearchPage).not.toHaveBeenCalled();
});

test("skips false-positive pages and preserves the server cursor and retention boundary", async () => {
  const { config, search } = setup();
  search.readPostSearchPage
    .mockResolvedValueOnce({
      items: [{ message: "night-owl, auroral, alex, `@night-owl`" }],
      isEnd: false,
      firstInaccessiblePostTime: 58,
    })
    .mockResolvedValueOnce({
      items: [
        { message: "**@night-owl**" },
        { message: "AURORA" },
        { message: "Hi Alex" },
      ],
      isEnd: false,
      firstInaccessiblePostTime: 0,
    });
  const mentions = await openRecentMentions(config, userId, search, false);
  const result = await mentions.readPage(0);
  expect(result.items.map((post) => post.message)).toEqual([
    "**@night-owl**",
    "AURORA",
    "Hi Alex",
  ]);
  expect(result.nextPage).toBe(2);
  expect(result.page).toBe(1);
  expect(result.firstInaccessiblePostTime).toBe(58);
  expect(await mentions.readPage(2)).toMatchObject({ nextPage: null, page: 2 });
  expect(search.readPostSearchPage.mock.calls.map(([q]) => q.page)).toEqual([
    0, 1, 2,
  ]);
});

test("matches an addressed username before sentence punctuation without including longer handles", async () => {
  const { config, search } = setup();
  const messages = [
    "Thank you @night-owl.",
    "Ping @NIGHT-OWL...:",
    "Hi @night-owl: ",
    "Hi @night-owl.extra",
    "Hi @night-owl-other",
    "Contact mail@night-owl.",
    "Use `@night-owl.`",
  ];
  search.readPostSearchPage.mockResolvedValueOnce({
    items: messages.map((message) => ({ message })),
    isEnd: true,
    firstInaccessiblePostTime: 0,
  });
  const mentions = await openRecentMentions(config, userId, search, false);
  const page = await mentions.readPage(0);
  expect(page.items.map((post) => post.message)).toEqual(messages.slice(0, 3));
});

test("keeps a multibyte keyword within a word and excludes bare keys in another account handle", async () => {
  const { config, search } = setup(
    userId,
    "aurora,番茄,이메일,@summit",
    "Élodie",
  );
  const expected = [
    "我爱吃番茄炒饭",
    "이메일을 보내다.",
    "BonjourÉlodie",
    "Ping @Élodie",
    "Aurora!",
    "Hi @summit",
  ];
  const excluded = [
    "Ping @aurora",
    "Ping @other.aurora",
    "éloDiebonjour",
    "Use :aurora:",
    "AURORAS",
  ];
  search.readPostSearchPage.mockResolvedValueOnce({
    items: [...expected, ...excluded].map((message) => ({ message })),
    isEnd: true,
    firstInaccessiblePostTime: 0,
  });
  const page = await (
    await openRecentMentions(config, userId, search, false)
  ).readPage(0);
  expect(page.items.map((post) => post.message)).toEqual(expected);
});

test("another account addressed by an ASCII first name is not a bare first-name mention", async () => {
  const { config, search } = setup();
  search.readPostSearchPage.mockResolvedValueOnce({
    items: [{ message: "Alex" }, { message: "Hi @Alex" }, { message: "alex" }],
    isEnd: true,
    firstInaccessiblePostTime: 0,
  });
  expect(
    (
      await (
        await openRecentMentions(config, userId, search, false)
      ).readPage(0)
    ).items,
  ).toEqual([{ message: "Alex" }]);
});

test("an enabled but empty first name never matches a trailing punctuation segment", async () => {
  const { config, search } = setup(userId, "aurora", "");
  search.readPostSearchPage.mockResolvedValueOnce({
    items: [
      { message: "night-owl." },
      { message: "auroral." },
      { message: "aurora." },
    ],
    isEnd: true,
    firstInaccessiblePostTime: 0,
  });
  const page = await (
    await openRecentMentions(config, userId, search, false)
  ).readPage(0);
  expect(page.items).toEqual([{ message: "aurora." }]);
});

test("cancelling after a filtered page prevents the next account request", async () => {
  const { config, search } = setup();
  const cancel = new AbortController();
  search.readPostSearchPage.mockImplementationOnce(async () => {
    cancel.abort();
    return {
      items: [{ message: "here" }],
      isEnd: false,
      firstInaccessiblePostTime: 0,
    };
  });
  const mentions = await openRecentMentions(config, userId, search, false);
  await expect(mentions.readPage(0, cancel.signal)).rejects.toThrow();
  expect(search.readPostSearchPage).toHaveBeenCalledTimes(1);
});
