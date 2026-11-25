import { expect, test, vi } from "vitest";
import { Configuration } from "../../vendor/mattermost/index.js";
import { workspaceServerPolicy } from "./workspace-preferences.ts";
import { loadWorkspaceServerPolicy } from "./workspace-server.ts";

const basePath = "https://chat.example.test/teams/north";
test("projects display and mention policy from the old config and license endpoints", async () => {
  const fetchApi = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    expect(url.search).toBe("?format=old");
    const data = url.pathname.endsWith("/config/client")
      ? {
          CollapsedThreads: "always_on",
          EnableConfirmNotificationsToChannel: "false",
          EnableCustomGroups: "true",
          MaxNotificationsPerChannel: "6",
          UniqueEmojiReactionLimitPerPost: "-2",
          FeatureFlagEnableSharedChannelsDMs: "true",
          ExperimentalGroupUnreadChannels: "default_on",
          TeammateNameDisplay: "full_name",
          LockTeammateNameDisplay: "true",
          Secret: "excluded",
        }
      : {
          LockTeammateNameDisplay: "false",
          IsLicensed: "true",
          LDAPGroups: "true",
          Company: "excluded",
        };
    return Response.json(data);
  });
  const policy = await loadWorkspaceServerPolicy(
    new Configuration({ basePath, fetchApi }),
  );
  expect(fetchApi.mock.calls.map(([u]) => String(u)).sort()).toEqual(
    ["config", "license"].map(
      (name) => `${basePath}/api/v4/${name}/client?format=old`,
    ),
  );
  expect(policy).toEqual({
    collapsedThreads: "always_on",
    separateUnreads: true,
    nameFormat: "full_name",
    lockNameFormat: false,
    sharedChannelDMs: true,
    uniqueReactionLimit: "-2",
    mentions: {
      confirmNotifications: false,
      maxNotificationsPerChannel: "6",
      customGroups: true,
      ldapGroups: true,
    },
  });
});

test("invalid fields and cancellation both release the outstanding sibling", async () => {
  const pending: AbortSignal[] = [];
  const fetchApi: typeof fetch = async (input, init) => {
    const signal = init?.signal;
    if (!signal) throw Error("missing signal");
    pending.push(signal);
    if (String(input).includes("/config/"))
      return Response.json({ CollapsedThreads: false });
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    );
  };
  await expect(
    loadWorkspaceServerPolicy(new Configuration({ basePath, fetchApi })),
  ).rejects.toThrow(TypeError);
  expect(pending.length).toBe(2);
  expect(pending[1].aborted).toBe(true);
  const controller = new AbortController();
  const reason = Error("left account");
  controller.abort(reason);
  await expect(
    loadWorkspaceServerPolicy(
      new Configuration({ basePath, fetchApi }),
      controller.signal,
    ),
  ).rejects.toBe(reason);
  expect(pending.length).toBe(2);
});

const mentionConfig = {
  MaxNotificationsPerChannel: "9223372036854775807",
  EnableConfirmNotificationsToChannel: "true",
  EnableCustomGroups: "false",
};

test.each([
  ["true", "true", true],
  ["true", undefined, false],
  ["true", "false", false],
  ["false", "true", false],
] as const)(
  "LDAP group mentions follow license %s and feature %s",
  (licensed, ldap, expected) => {
    expect(
      workspaceServerPolicy(mentionConfig, {
        IsLicensed: licensed,
        LDAPGroups: ldap,
      }).mentions,
    ).toEqual({
      confirmNotifications: true,
      maxNotificationsPerChannel: "9223372036854775807",
      customGroups: false,
      ldapGroups: expected,
    });
  },
);

test("a partial response leaves mention policy unknown and keeps display policy", () => {
  for (const config of [
    {},
    { ...mentionConfig, MaxNotificationsPerChannel: undefined },
    { ...mentionConfig, EnableConfirmNotificationsToChannel: undefined },
    { ...mentionConfig, EnableCustomGroups: undefined },
  ]) {
    const policy = workspaceServerPolicy(
      { ...config, CollapsedThreads: "always_on" },
      { IsLicensed: "false" },
    );
    expect(policy.mentions).toBeUndefined();
    expect(policy.collapsedThreads).toBe("always_on");
  }
  expect(workspaceServerPolicy(mentionConfig, {}).mentions).toBeUndefined();
});

test.each([
  "0",
  "-1",
  "00",
  "01",
  "2x",
  "1.5",
  "1e5",
  " 6",
  "1\n",
  "9223372036854775808",
])("rejects invalid wire limit %j", (limit) => {
  expect(() =>
    workspaceServerPolicy(
      { ...mentionConfig, MaxNotificationsPerChannel: limit },
      { IsLicensed: "false" },
    ),
  ).toThrow(TypeError);
});

test("a malformed flag prevents publication", () => {
  expect(() =>
    workspaceServerPolicy(
      { ...mentionConfig, EnableConfirmNotificationsToChannel: "yes" },
      { IsLicensed: "true" },
    ),
  ).toThrow(TypeError);
  expect(() =>
    workspaceServerPolicy(mentionConfig, {
      IsLicensed: "true",
      LDAPGroups: "unknown",
    }),
  ).toThrow(TypeError);
});

test("keeps the exact signed limit and distinguishes an absent value", () => {
  expect(workspaceServerPolicy({}, {}).uniqueReactionLimit).toBeUndefined();
  for (const value of [
    "-9223372036854775808",
    "-2",
    "0",
    "1",
    "500",
    "9223372036854775807",
  ]) {
    expect(
      workspaceServerPolicy({ UniqueEmojiReactionLimitPerPost: value }, {})
        .uniqueReactionLimit,
    ).toBe(value);
  }
  for (const value of [
    "",
    "00",
    "-0",
    "+1",
    "3.0",
    "1\n",
    "1e2",
    "-9223372036854775809",
    "9223372036854775808",
  ]) {
    expect(() =>
      workspaceServerPolicy({ UniqueEmojiReactionLimitPerPost: value }, {}),
    ).toThrow(TypeError);
  }
});
