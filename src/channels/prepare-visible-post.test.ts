import { expect, test, vi } from "vitest";
import {
  prepareVisiblePost,
  type VisiblePostContext,
} from "./prepare-visible-post.ts";

const account = {
  readChannelMemberCount: vi.fn(),
  readChannelTimezoneCount: vi.fn(),
  readAssociatedMentionGroups: vi.fn(),
  searchMentionGroups: vi.fn(),
  readMentionGroupCounts: vi.fn(),
};
const context: VisiblePostContext = {
  account,
  channel: { id: "c".repeat(26), groupConstrained: false },
  team: { id: "t".repeat(26), groupConstrained: false },
  settings: undefined,
  channelPermission: "unknown",
  groupPermission: "unknown",
};
const signal = new AbortController().signal;
test("plain text and inline code can send while mention permissions are loading", async () => {
  for (const message of ["hi", "Use `@channel` here"]) {
    await expect(prepareVisiblePost(context, message, signal)).resolves.toEqual(
      { kind: "ready", confirmation: null, suppression: null },
    );
  }
  expect(account.readChannelMemberCount).not.toHaveBeenCalled();
  expect(account.searchMentionGroups).not.toHaveBeenCalled();
});
test("an unresolved broadcast stays in the editor and a known audience names the actual recipients", async () => {
  const settings = {
    maxNotificationsPerChannel: "100",
    confirmNotifications: true,
    customGroups: false,
    ldapGroups: false,
  };
  await expect(
    prepareVisiblePost({ ...context, settings }, "@all hello", signal),
  ).resolves.toEqual({ kind: "policyUnavailable" });
  account.readChannelMemberCount.mockResolvedValueOnce(12);
  account.readChannelTimezoneCount.mockResolvedValueOnce(3);
  const decision = await prepareVisiblePost(
    { ...context, settings, channelPermission: "allowed" },
    "@all hello",
    signal,
  );
  expect(decision).toMatchObject({
    kind: "ready",
    confirmation: { kind: "channel", members: 11, timezones: 3 },
  });
  expect(account.readChannelMemberCount).toHaveBeenCalledTimes(1);
});

test("a confirmed broadcast takes precedence while group permission is loading", async () => {
  const settings = {
    confirmNotifications: true,
    ldapGroups: true,
    customGroups: true,
    maxNotificationsPerChannel: "1000",
  };
  account.readChannelMemberCount.mockResolvedValueOnce(20);
  account.readChannelTimezoneCount.mockResolvedValueOnce(2);
  const result = await prepareVisiblePost(
    { ...context, settings, channelPermission: "allowed" },
    "@channel @release",
    signal,
  );
  expect(result).toMatchObject({
    kind: "ready",
    confirmation: { kind: "channel", members: 19 },
  });
  expect(account.searchMentionGroups).not.toHaveBeenCalled();
});
