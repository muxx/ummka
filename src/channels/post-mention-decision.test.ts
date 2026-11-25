import { expect, test, vi } from "vitest";
import { composerPostMentions } from "./composer-mentions.ts";
import { readPostMentionDecision } from "./post-mention-decision.ts";

const channel = { id: "c".repeat(26), groupConstrained: false };
const team = { id: "t".repeat(26), groupConstrained: false };
const groupId = "g".repeat(26);
const policy = {
  confirmNotifications: true,
  maxNotificationsPerChannel: 12n,
  canMentionChannel: true,
  canMentionGroups: true,
  customGroups: true,
  ldapGroups: false,
};
function connection(members = 12) {
  return {
    readChannelMemberCount: vi.fn(async () => members),
    readChannelTimezoneCount: vi.fn(async () => 2),
    searchMentionGroups: vi.fn(async () => [
      {
        id: groupId,
        name: "release",
        source: "custom",
        allowReference: true,
        deleteAt: 0,
        remoteId: null,
      },
    ]),
    readAssociatedMentionGroups: vi.fn(async () => []),
    readMentionGroupCounts: vi.fn(
      async () => new Map([[groupId, { members: 7, timezones: 3 }]]),
    ),
  };
}
test("an active broadcast wins without querying groups or their counts", async () => {
  const account = connection(11);
  const result = await readPostMentionDecision(
    account,
    channel,
    team,
    composerPostMentions("@here @release"),
    policy,
  );
  expect(result).toEqual({
    kind: "ready",
    confirmation: {
      kind: "here",
      mentions: ["@here"],
      members: 10,
      timezones: 2,
    },
    suppression: null,
  });
  expect(account.readChannelMemberCount).toHaveBeenCalledTimes(1);
  expect(account.readChannelTimezoneCount).toHaveBeenCalledTimes(1);
  expect(account.searchMentionGroups).not.toHaveBeenCalled();
  expect(account.readMentionGroupCounts).not.toHaveBeenCalled();
});
test.each(["limit", "permission"] as const)(
  "keeps group confirmation alongside broadcast %s",
  async (reason) => {
    const account = connection(12);
    const result = await readPostMentionDecision(
      account,
      channel,
      team,
      composerPostMentions("@all @release"),
      { ...policy, canMentionChannel: reason !== "permission" },
    );
    expect(result).toEqual({
      kind: "ready",
      confirmation: {
        kind: "groups",
        mentions: ["@release"],
        members: 7,
        timezones: 3,
      },
      suppression:
        reason === "limit"
          ? { kind: "limit", members: 12, maximum: 12n }
          : { kind: "permission" },
    });
    expect(account.readChannelMemberCount).toHaveBeenCalledTimes(
      reason === "limit" ? 1 : 0,
    );
    expect(account.readChannelTimezoneCount).not.toHaveBeenCalled();
    expect(account.searchMentionGroups).toHaveBeenCalledTimes(1);
    expect(account.readMentionGroupCounts).toHaveBeenCalledTimes(1);
  },
);
test("ordinary Markdown never requests a directory, group-only text never requests the channel count", async () => {
  const account = connection();
  expect(
    await readPostMentionDecision(
      account,
      channel,
      team,
      composerPostMentions(
        "See `@all` and [notes](https://example.test/@release)",
      ),
      policy,
    ),
  ).toEqual({ kind: "ready", confirmation: null, suppression: null });
  for (const fn of Object.values(account)) expect(fn).not.toHaveBeenCalled();
  const result = await readPostMentionDecision(
    account,
    channel,
    team,
    composerPostMentions("@release"),
    policy,
  );
  expect(result).toMatchObject({
    kind: "ready",
    confirmation: { kind: "groups" },
  });
  expect(account.readChannelMemberCount).not.toHaveBeenCalled();
});
test("returns the missing group scope, and skips group reads when confirmation is disabled", async () => {
  const account = connection();
  const mentions = composerPostMentions("@release");
  expect(
    await readPostMentionDecision(account, { id: channel.id }, team, mentions, {
      ...policy,
      ldapGroups: true,
    }),
  ).toEqual({ kind: "refresh-channel" });
  expect(
    await readPostMentionDecision(account, channel, { id: team.id }, mentions, {
      ...policy,
      ldapGroups: true,
    }),
  ).toEqual({ kind: "refresh-team" });
  expect(
    await readPostMentionDecision(account, channel, team, mentions, {
      ...policy,
      confirmNotifications: false,
    }),
  ).toEqual({ kind: "ready", confirmation: null, suppression: null });
  for (const fn of Object.values(account)) expect(fn).not.toHaveBeenCalled();
});
test("failure or cancellation at the broadcast step stops subsequent group reads", async () => {
  const account = connection();
  const text = composerPostMentions("@all @release");
  const reason = Error("Left the channel");
  account.readChannelMemberCount.mockRejectedValueOnce(reason);
  await expect(
    readPostMentionDecision(account, channel, team, text, policy),
  ).rejects.toBe(reason);
  const ctl = new AbortController();
  account.readChannelMemberCount.mockImplementationOnce(async () => {
    ctl.abort(reason);
    return 12;
  });
  await expect(
    readPostMentionDecision(account, channel, team, text, policy, ctl.signal),
  ).rejects.toBe(reason);
  expect(account.searchMentionGroups).not.toHaveBeenCalled();
  expect(account.readChannelTimezoneCount).not.toHaveBeenCalled();
});
