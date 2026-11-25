import { expect, test } from "vitest";
import { mentionTextCases } from "../../scripts/contract/compatibility/mention-text-cases.ts";
import { composerPostMentions } from "./composer-mentions.ts";

test.each([
  ["", []],
  ["no mentions", []],
  ["/away @all", ["@all"]],
  [" /not_cmd @all", ["@all"]],
  ["@ALL, @channel and @HERE…", ["@all", "@channel", "@here"]],
  ["@channel @CHANNEL @here @channel", ["@channel", "@here"]],
  ["@all123 @allison hi@all @all.com @here-net @channel_team", []],
  ["noise/@here… @all. @channel:+1:", ["@here", "@all", "@channel"]],
  ["@here/room and @all/@channel", ["@here", "@all", "@channel"]],
  [
    "@all@example.com https://chat.example/@here <https://example.org/@channel>",
    [],
  ],
  ["mail someone@here.net and word_@all", []],
  ["\\@here", ["@here"]],
  ["_@all_ **@here** ~~@channel~~", ["@all", "@here", "@channel"]],
  ["@cha*nnel* *@cha*nnel @cha**nnel**", []],
  ["@he![bear](https://example.org/a)re", []],
  [
    "[notify @here](https://example.org/@all) ![bear @channel](https://example.org/@all)",
    ["@here", "@channel"],
  ],
  ["[`@all`](https://example.org/@channel) and `@here`", []],
  ["```js\n@here\n```\n@all", ["@all"]],
  ["~~~@all~~~", []],
  ["    @here\n    @all", []],
  ["> @here\n\n- **@all**", ["@here", "@all"]],
  ["| one | two |\n| --- | --- |\n| @here | `@all` |", ["@here"]],
  ['<span title="@all">hello</span>', ["@all"]],
] as const)("collects whole channel references in %j", (message, channel) => {
  expect(composerPostMentions(message).channel).toEqual(channel);
});

test("keeps first appearance and spelling of candidates for the server group directory", () => {
  const text =
    "Meeting @RElease.qa @all. @Dev-Team and @dev-team, @team_one! @Release.qa";
  expect(composerPostMentions(text)).toEqual({
    channel: ["@all"],
    groupCandidates: ["release.qa", "dev-team", "team_one"],
  });
  expect(
    composerPostMentions(
      "(@docs.) `@secret` <https://example.org/@archive> @...",
    ).groupCandidates,
  ).toEqual(["docs."]);
});

test("keeps eligible group handles next to colon punctuation", () => {
  expect(
    composerPostMentions(
      "@ops: @docs:. @product.: @ops:smile:world hi:smile:@releases",
    ),
  ).toEqual({
    channel: [],
    groupCandidates: ["ops", "docs", "product.", "releases"],
  });
});

test.each(mentionTextCases)(
  "reflects notification delivery on both tagged servers for %j",
  (message, alertsReader) => {
    expect(composerPostMentions(message).channel.includes("@all")).toBe(
      alertsReader,
    );
  },
);
