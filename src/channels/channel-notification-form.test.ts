import { expect, test } from "vitest";
import { ChannelNotificationForm } from "./channel-notification-form.ts";

test("group mentions expand only when inherited, each device keeps its source", () => {
  const account = {
    desktop: "mention",
    push: "mention",
    pushThreads: "mention",
  };
  const source = { account, channel: { push: "mention", pushThreads: "all" } };
  const form = new ChannelNotificationForm("G", source);
  expect(form.section("desktop")).toEqual({
    level: { value: "all", account: "all", inherited: true },
    threads: { value: "all", account: "all", inherited: true },
  });
  expect(form.section("push")).toEqual({
    level: { value: "mention", account: "all", inherited: false },
    threads: { value: "all", account: "mention", inherited: false },
  });
  expect(
    new ChannelNotificationForm("P", source).section("desktop").level.value,
  ).toBe("mention");
  form.setLevel("push", "all");
  expect(form.changes).toEqual({ push: "default" });
  form.setLevel("push", "mention");
  expect(form.changes).toEqual({});
});

test("a matching override survives edits to another field until explicitly reset", () => {
  const form = new ChannelNotificationForm("O", {
    account: { desktop: "mention", push: "none" },
    channel: {
      desktop: "mention",
      push: "next-version-level",
      desktopThreads: "all",
      email: "future",
    },
  });
  expect(form.section("desktop").level).toEqual({
    value: "mention",
    account: "mention",
    inherited: false,
  });
  form.setFollowThreads(true);
  expect(form.followThreads).toBe(true);
  expect(form.changes).toEqual({ channelAutoFollowThreads: "on" });
  form.resetSection("desktop");
  expect(form.changes).toEqual({
    desktop: "default",
    desktopThreads: "default",
    channelAutoFollowThreads: "on",
  });
  expect(form.section("push").level.value).toBe("next-version-level");
});

test("mute keeps levels, reply preferences and explicit broadcast decisions", () => {
  const source = {
    account: {},
    channel: { desktop: "none", pushThreads: "mention" },
  };
  const form = new ChannelNotificationForm("O", source);
  expect(form.ignoreMentions).toEqual({
    blocked: false,
    inherited: true,
    value: false,
  });
  form.setMuted(true);
  expect(form.ignoreMentions.value).toBe(true);
  form.setIgnoreMentions(false);
  expect(form.ignoreMentions.value).toBe(false);
  expect(form.changes).toEqual({
    markUnread: "mention",
    ignoreChannelMentions: "off",
  });
  form.setIgnoreMentions(true);
  form.setMuted(false);
  expect(form.changes).toEqual({});
  const blocked = new ChannelNotificationForm("P", {
    account: { channel: "false" },
    channel: { ignoreChannelMentions: "off" },
  });
  blocked.setIgnoreMentions(false);
  expect(blocked.ignoreMentions).toMatchObject({ blocked: true, value: true });
  expect(blocked.changes).toEqual({});
});

test("desktop sound keeps the stored melody when silenced, reset leaves phone alone", () => {
  const source = {
    account: { desktopNotificationSound: "Hello", desktopSound: "true" },
    channel: { desktopNotificationSound: "Crackle", push: "none" },
  };
  const form = new ChannelNotificationForm("O", source);
  expect(form.sound).toEqual({
    value: "Crackle",
    account: "Hello",
    inherited: false,
  });
  form.setSound("Ripple");
  expect(form.changes).toEqual({
    desktopNotificationSound: "Ripple",
    desktopSound: "on",
  });
  form.setSound("off");
  expect(form.changes).toEqual({ desktopSound: "off" });
  expect(form.sound.value).toBe("off");
  form.resetSection("push");
  expect(form.sound.value).toBe("off");
  form.resetSection("desktop");
  expect(form.sound).toEqual({
    value: "Hello",
    account: "Hello",
    inherited: true,
  });
  expect(form.changes).toEqual({
    push: "default",
    desktopNotificationSound: "default",
  });
  expect(source.channel).toEqual({
    desktopNotificationSound: "Crackle",
    push: "none",
  });
});

test("a silent account, missing settings and reopening honor each source", () => {
  const source = {
    account: { desktopSound: "false", desktop: "none" },
    channel: {},
  };
  const form = new ChannelNotificationForm("P", source);
  expect(form.sound).toEqual({ value: "off", account: "off", inherited: true });
  form.setSound("Down");
  expect(form.sound.value).toBe("Down");
  form.setSound("off");
  expect(form.changes).toEqual({});
  form.setLevel("desktop", "all");
  source.account.desktop = "mention";
  expect(form.section("desktop").level.account).toBe("none");
  const reopened = new ChannelNotificationForm("P", source);
  expect(reopened.section("desktop").level.value).toBe("mention");
  expect(reopened.changes).toEqual({});
  expect(reopened.section("push").level.value).toBe("all");
});
