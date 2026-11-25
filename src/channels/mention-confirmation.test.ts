import { expect, test } from "vitest";
import { mentionConfirmation } from "./mention-confirmation.ts";

const policy = {
  confirmNotifications: true,
  maxNotificationsPerChannel: 10n,
  canMentionChannel: true,
  canMentionGroups: true,
};
const channel = { channel: ["@channel"], groups: [] } as const;
const normal = { members: 8, timezones: 3 };
const small = { handle: "docs", members: 5, timezones: 4 };
const large = { handle: "release-qa", members: 7, timezones: 2 };
const none = {
  confirmation: null,
  groupsSuppressed: false,
  channelSuppression: null,
};

test.each([2, 5, 6, 9, 10, 11])(
  "channel with %i members respects both boundaries and excludes the sender",
  (members) => {
    const result = mentionConfirmation(
      channel,
      { members, timezones: 0 },
      policy,
    );
    if (members <= 5) expect(result).toEqual(none);
    else if (members >= 10)
      expect(result).toEqual({ ...none, channelSuppression: "limit" });
    else
      expect(result).toEqual({
        ...none,
        confirmation: {
          kind: "channel",
          mentions: ["@channel"],
          members: members - 1,
          timezones: 0,
        },
      });
  },
);
test("here describes an upper bound and a simultaneous all or channel mention covers everyone", () => {
  expect(
    mentionConfirmation({ channel: ["@here"], groups: [] }, normal, policy)
      .confirmation,
  ).toEqual({
    kind: "here",
    mentions: ["@here"],
    members: 7,
    timezones: 3,
  });
  expect(
    mentionConfirmation(
      { channel: ["@here", "@all", "@here"], groups: [large] },
      normal,
      policy,
    ).confirmation,
  ).toEqual({
    kind: "channel",
    mentions: ["@here", "@all"],
    members: 7,
    timezones: 3,
  });
});

test("group intersections are counted separately, including when a channel mention is silent", () => {
  const mentions = {
    channel: ["@channel"] as const,
    groups: [small, large, { handle: "team", members: 6, timezones: 5 }, large],
  };
  const groups = {
    kind: "groups",
    mentions: ["@docs", "@release-qa", "@team"],
    members: 7,
    timezones: 2,
  };
  expect(
    mentionConfirmation(mentions, normal, {
      ...policy,
      canMentionChannel: false,
    }),
  ).toEqual({
    ...none,
    channelSuppression: "permission",
    confirmation: groups,
  });
  expect(
    mentionConfirmation(mentions, { members: 11, timezones: 3 }, policy),
  ).toEqual({ ...none, channelSuppression: "limit", confirmation: groups });
  expect(
    mentionConfirmation({ channel: [], groups: [small] }, normal, policy),
  ).toEqual(none);
});
test("equal largest groups keep the timezone count of the first group", () => {
  expect(
    mentionConfirmation(
      {
        channel: [],
        groups: [large, { handle: "launch", members: 7, timezones: 4 }],
      },
      normal,
      policy,
    ).confirmation,
  ).toMatchObject({ members: 7, timezones: 2 });
});
test("confirmation settings leave channel and group restrictions independent", () => {
  const mentions = { channel: ["@all"] as const, groups: [large] };
  expect(
    mentionConfirmation(mentions, normal, {
      ...policy,
      confirmNotifications: false,
    }),
  ).toEqual(none);
  expect(
    mentionConfirmation(mentions, normal, {
      ...policy,
      confirmNotifications: false,
      canMentionGroups: false,
      canMentionChannel: false,
    }),
  ).toEqual({
    ...none,
    groupsSuppressed: true,
    channelSuppression: "permission",
  });
  expect(
    mentionConfirmation(mentions, normal, {
      ...policy,
      canMentionGroups: false,
    }),
  ).toMatchObject({
    groupsSuppressed: true,
    confirmation: { kind: "channel" },
  });
  expect(
    mentionConfirmation({ channel: [], groups: [large] }, normal, {
      ...policy,
      canMentionGroups: false,
    }),
  ).toEqual({ ...none, groupsSuppressed: true });
  expect(
    mentionConfirmation({ channel: [], groups: [] }, normal, {
      ...policy,
      canMentionGroups: false,
      canMentionChannel: false,
    }),
  ).toEqual(none);
});

test("an int64 limit above the safe count range still allows confirmation", () => {
  const result = mentionConfirmation(
    channel,
    { members: Number.MAX_SAFE_INTEGER, timezones: 2 },
    { ...policy, maxNotificationsPerChannel: 9223372036854775807n },
  );
  expect(result.channelSuppression).toBeNull();
  expect(result.confirmation?.members).toBe(Number.MAX_SAFE_INTEGER - 1);
});
