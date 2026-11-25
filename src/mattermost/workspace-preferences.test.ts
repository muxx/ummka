import { expect, test } from "vitest";
import {
  effectiveWorkspacePreferences,
  sidebarPreferences,
  visibleConversationLimit,
  workspacePreferences,
  workspaceServerPolicy,
} from "./workspace-preferences.ts";

const me = "a".repeat(26),
  other = "b".repeat(26),
  channel = "c".repeat(26);
const pref = (category: string, name: string, value: string) => ({
  userId: me,
  category,
  name,
  value,
});
const display = (name: string, value: string) =>
  pref("display_settings", name, value);
const sidebar = (name: string, value: string) =>
  pref("sidebar_settings", name, value);

test("honours independent Mattermost keyboard settings on the signed-in account", () => {
  const advanced = (name: string, value: string) =>
    pref("advanced_settings", name, value);
  expect(sidebarPreferences(me, []).composerKeys).toEqual({
    sendOnCtrlEnter: false,
    codeBlockOnCtrlEnter: true,
  });
  const rows = [
    advanced("send_on_ctrl_enter", "true"),
    advanced("code_block_ctrl_enter", "false"),
    display("send_on_ctrl_enter", "false"),
  ];
  expect(sidebarPreferences(me, rows).composerKeys).toEqual({
    sendOnCtrlEnter: true,
    codeBlockOnCtrlEnter: false,
  });
  expect(
    sidebarPreferences(me, [
      advanced("send_on_ctrl_enter", ""),
      advanced("code_block_ctrl_enter", "FALSE"),
    ]).composerKeys,
  ).toEqual({ sendOnCtrlEnter: true, codeBlockOnCtrlEnter: true });
  expect(() => sidebarPreferences(me, [{ ...rows[0], userId: other }])).toThrow(
    "account preference",
  );
  const { composerKeys, ...old } = sidebarPreferences(me, []);
  expect(
    effectiveWorkspacePreferences(old, workspaceServerPolicy({}, {}))
      .composerKeys,
  ).toBeUndefined();
  expect(
    effectiveWorkspacePreferences(
      { ...old, composerKeys },
      workspaceServerPolicy({}, {}),
    ).composerKeys,
  ).toEqual(composerKeys);
});
test("chooses thread counters using the server policy and the individual's setting", () => {
  for (const [mode, defaults, on, off] of [
    [undefined, false, false, false],
    ["disabled", false, false, false],
    ["default_off", false, true, false],
    ["default_on", true, true, false],
    ["always_on", true, true, true],
  ] as const) {
    const policy = (rows: ReturnType<typeof pref>[]) =>
      workspacePreferences(me, rows, { CollapsedThreads: mode }, {})
        .collapsedThreads;
    expect([
      policy([]),
      policy([display("collapsed_reply_threads", "on")]),
      policy([display("collapsed_reply_threads", "off")]),
    ]).toEqual([defaults, on, off]);
  }
});

test("uses one explicit limit on both form factors and applies each platform's default", () => {
  const missing = workspacePreferences(me, [], {}, {});
  expect([
    visibleConversationLimit(missing, false),
    visibleConversationLimit(missing, true),
  ]).toEqual([40, 20]);
  const rows = [
    sidebar("limit_visible_dms_gms", "15"),
    display("name_format", "nickname_full_name"),
  ];
  const config = {
    TeammateNameDisplay: "full_name",
    LockTeammateNameDisplay: "true",
  };
  expect(workspacePreferences(me, rows, config, {}).nameFormat).toBe(
    "nickname_full_name",
  );
  const locked = workspacePreferences(me, rows, config, {
    LockTeammateNameDisplay: "true",
  });
  expect(locked.nameFormat).toBe("full_name");
  expect([
    visibleConversationLimit(locked, false),
    visibleConversationLimit(locked, true),
  ]).toEqual([15, 15]);
});

test("resolves the modern, legacy and server unread-section choices in priority order", () => {
  const policy = (rows: ReturnType<typeof pref>[]) =>
    workspacePreferences(
      me,
      rows,
      { ExperimentalGroupUnreadChannels: "default_on" },
      {},
    ).separateUnreads;
  expect(policy([])).toBe(true);
  expect(policy([sidebar("", '{"unreads_at_top":"false"}')])).toBe(false);
  expect(
    policy([
      sidebar("", '{"unreads_at_top":"true"}'),
      sidebar("show_unread_section", "false"),
    ]),
  ).toBe(false);
  expect(
    policy([
      sidebar("", "invalid legacy payload"),
      sidebar("show_unread_section", "true"),
    ]),
  ).toBe(true);
  expect(() => policy([sidebar("", "invalid legacy payload")])).toThrow();
});

test("keys direct messages by person, groups by channel, and keeps only the later view time", () => {
  const rows = [
    pref("direct_channel_show", other, "true"),
    pref("group_channel_show", channel, "true"),
    pref("direct_channel_show", channel, "false"),
    pref("channel_open_time", channel, "180"),
    pref("channel_approximate_view_time", channel, "250"),
    pref("notifications", "private", "ignored"),
  ];
  const data = workspacePreferences(me, rows, {}, {});
  expect(data.directShown).toEqual({ [other]: true });
  expect(data.groupShown).toEqual({ [channel]: true });
  expect(data.viewTimes).toEqual({ [channel]: 250 });
  expect(workspacePreferences(me, [...rows].reverse(), {}, {})).toEqual(data);
  expect(JSON.stringify(data)).not.toContain("private");
  expect(() =>
    workspacePreferences(me, [{ ...rows[0], userId: other }], {}, {}),
  ).toThrow("account preference");
  expect(() =>
    workspacePreferences(
      me,
      [pref("channel_open_time", "invalid", "1")],
      {},
      {},
    ),
  ).toThrow();
  expect(() =>
    workspacePreferences(
      me,
      [sidebar("limit_visible_dms_gms", "invalid")],
      {},
      {},
    ),
  ).toThrow();
});

test("only the server's enabled flag allows cross-server direct messages", () => {
  for (const value of [undefined, "", "false", "TRUE", "true"]) {
    expect(
      workspaceServerPolicy({ FeatureFlagEnableSharedChannelsDMs: value }, {})
        .sharedChannelDMs,
    ).toBe(value === "true");
  }
});
