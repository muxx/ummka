import type { Configuration } from "../../vendor/mattermost/index.js";
import type { accountSearch } from "./account-search.ts";
import { mentionableText, mentionWords } from "./post-mentions.ts";
import {
  profileSearchTimezone,
  readSearchProfile,
  searchTimezoneOffsetSeconds,
} from "./search-timezone.ts";

const broadcasts = new Set(["@channel", "@all", "@here"]);

function keywordFilter(keys: string[], firstName: string | undefined) {
  const insensitive = new Set(keys.map((key) => key.toLowerCase()));
  const unicode = [...insensitive, ...(firstName ? [firstName] : [])].filter(
    (key) => /[^\p{ASCII}]/u.test(key),
  );
  // A configured phrase stays intact even though the REST search takes words.
  const phrases = [...keys, ...(firstName ? [firstName] : [])]
    .filter((key) => /\s/u.test(key))
    .map((key) => {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(
        `(?:^|[^\\p{L}\\p{N}_@])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
        insensitive.has(key.toLowerCase()) ? "iu" : "u",
      );
    });
  const exact = (word: string) =>
    insensitive.has(word.toLowerCase()) || word === firstName;
  return (message: string) => {
    const text = mentionableText(message);
    for (const word of mentionWords(text)) {
      let candidate = word;
      while (candidate) {
        if (exact(candidate)) return true;
        if (!".-:_".includes(candidate.slice(-1))) break;
        candidate = candidate.slice(0, -1);
      }
      if (!word.startsWith("@") && word.split(/[.:-]/).some(exact)) return true;
      if (unicode.some((key) => word.includes(key))) return true;
    }
    return phrases.some((pattern) => pattern.test(text));
  };
}

export async function openRecentMentions(
  config: Configuration,
  userId: string,
  search: Pick<ReturnType<typeof accountSearch>, "readPostSearchPage">,
  includeDeletedChannels: boolean,
  signal?: AbortSignal,
) {
  const user = await readSearchProfile(config, userId, signal);
  const settings = user.notifyProps;
  if (!settings || typeof user.username !== "string" || !user.username)
    throw new TypeError("Missing signed mention profile.");

  const username = user.username.toLowerCase();
  const keys = (settings.mentionKeys ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(
      (key) =>
        key &&
        !broadcasts.has(key.toLowerCase()) &&
        key.toLowerCase() !== `@${username}`,
    );
  const firstName =
    settings.firstName === "true" && user.firstName
      ? user.firstName
      : undefined;
  const includeBroadcasts = settings.channel === "true";
  const queryKeys = [
    `@${username}`,
    ...keys,
    ...(includeBroadcasts ? broadcasts : []),
  ];
  const words = new Set(
    [...queryKeys, ...(firstName ? [firstName] : [])].flatMap((key) =>
      key.split(" ").filter(Boolean),
    ),
  );
  const terms = Array.from(words, (word) => `"${word}"`).join(" ");
  const matches = keywordFilter(queryKeys, firstName);
  const timeZoneOffsetSeconds = searchTimezoneOffsetSeconds(
    profileSearchTimezone(user),
  );
  return {
    async readPage(page: number, signal?: AbortSignal) {
      let firstInaccessiblePostTime = 0;
      for (let index = page; ; index++) {
        signal?.throwIfAborted();
        const result = await search.readPostSearchPage(
          {
            terms,
            teamId: null,
            isOrSearch: true,
            includeDeletedChannels,
            timeZoneOffsetSeconds,
            page: index,
          },
          signal,
        );
        const items = result.items.filter((post) =>
          matches(post.message ?? ""),
        );
        firstInaccessiblePostTime = Math.max(
          firstInaccessiblePostTime,
          result.firstInaccessiblePostTime,
        );
        if (items.length || result.isEnd) {
          return {
            items,
            nextPage: result.isEnd ? null : index + 1,
            firstInaccessiblePostTime,
          };
        }
      }
    },
  };
}
