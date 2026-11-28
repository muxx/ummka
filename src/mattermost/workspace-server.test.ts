import { expect, test, vi } from "vitest";
import { Configuration } from "../../vendor/mattermost/index.js";
import {
  postEditWindow,
  workspaceServerPolicy,
} from "./workspace-preferences.ts";
import {
  loadWorkspaceConfiguration,
  loadWorkspaceServerPolicy,
} from "./workspace-server.ts";

const basePath = "https://chat.example.test/teams/north";
test("projects display and mention policy from the old config and license endpoints", async () => {
  const fetchApi = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    expect(url.search).toBe("?format=old");
    const data = url.pathname.endsWith("/config/client")
      ? {
          CollapsedThreads: "always_on",
          EnableUserStatuses: "false",
          HideGuestTags: "false",
          EnableConfirmNotificationsToChannel: "false",
          EnableCustomGroups: "true",
          MaxNotificationsPerChannel: "6",
          UniqueEmojiReactionLimitPerPost: "-2",
          PostEditTimeLimit: "9007199254740993",
          EnableCrossTeamSearch: "true",
          EnableFileAttachments: "true",
          MaxFileSize: "9007199254740993",
          ExperimentalViewArchivedChannels: "false",
          RestrictDirectMessage: "team",
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
    userStatusesEnabled: false,
    hideGuestTags: false,
    sharedChannelDMs: true,
    dmRecipientScope: "team",
    search: { allTeams: true, files: true, archivedChannels: false },
    fileUpload: { kind: "enabled", maxFileBytes: "9007199254740993" },
    uniqueReactionLimit: "-2",
    postEditLimitSeconds: "9007199254740993",
    mentions: {
      confirmNotifications: false,
      maxNotificationsPerChannel: "6",
      customGroups: true,
      ldapGroups: true,
    },
  });
});

test("keeps a missing guest-tag flag unknown and accepts only exact wire booleans", async () => {
  let settings: Record<string, unknown> = {};
  const config = new Configuration({
    basePath,
    fetchApi: async (url) =>
      Response.json(
        String(url).includes("/config/")
          ? settings
          : { IsLicensed: "false", HideGuestTags: "true" },
      ),
  });
  expect(await loadWorkspaceServerPolicy(config)).not.toHaveProperty(
    "hideGuestTags",
  );
  for (const value of [false, true]) {
    settings = { HideGuestTags: String(value), EnableGuestAccounts: "false" };
    expect((await loadWorkspaceServerPolicy(config)).hideGuestTags).toBe(value);
  }
  for (const value of [null, false, true, 0, "", "TRUE", "false ", "yes", {}]) {
    settings = { HideGuestTags: value };
    await expect(loadWorkspaceServerPolicy(config)).rejects.toThrow(TypeError);
  }
});

test("publishes a zero limit, distinguishes disabled uploads and isolates invalid upload settings", async () => {
  let settings: Record<string, unknown> = {
    EnableFileAttachments: "true",
    EnableFileSearch: "false",
    MaxFileSize: "0",
    CollapsedThreads: "always_on",
  };
  const config = new Configuration({
    basePath,
    fetchApi: async (url) =>
      Response.json(String(url).includes("/config/") ? settings : {}),
  });
  const initial = await loadWorkspaceServerPolicy(config);
  expect(initial.fileUpload).toEqual({ kind: "enabled", maxFileBytes: "0" });
  expect(initial.search?.files).toBe(false);

  for (const bad of [
    undefined,
    null,
    5,
    "",
    "05",
    "-1",
    "-0",
    "1.5",
    "1e5",
    "1\n",
    "9223372036854775808",
  ]) {
    settings = { ...settings, MaxFileSize: bad };
    const policy = await loadWorkspaceServerPolicy(config);
    expect(policy.fileUpload).toBeUndefined();
    expect(policy.collapsedThreads).toBe("always_on");
    expect(policy.search?.files).toBe(false);
  }
  settings = { ...settings, EnableFileAttachments: "false" };
  expect((await loadWorkspaceServerPolicy(config)).fileUpload).toEqual({
    kind: "disabled",
  });
  settings = { ...settings, EnableFileAttachments: false, MaxFileSize: "30" };
  expect((await loadWorkspaceServerPolicy(config)).fileUpload).toBeUndefined();
  settings = { ...settings, EnableFileAttachments: "true" };
  expect((await loadWorkspaceServerPolicy(config)).fileUpload).toEqual({
    kind: "enabled",
    maxFileBytes: "30",
  });
});

test.each([
  ["true", "true", "false", "disabled"],
  ["true", "true", "true", "enabled"],
  ["true", "true", undefined, "enabled"],
  ["true", "true", "", "enabled"],
  ["true", "true", "unexpected", "disabled"],
  ["true", "false", "false", "enabled"],
  ["true", undefined, "false", "enabled"],
  ["false", "true", "false", "enabled"],
  [undefined, "true", "false", "enabled"],
  [undefined, undefined, "false", "enabled"],
] as const)(
  "matches Mobile for license %s, Compliance %s and upload flag %s independently of desktop",
  async (IsLicensed, Compliance, EnableMobileFileUpload, kind) => {
    const config = new Configuration({
      basePath,
      fetchApi: async (url) =>
        Response.json(
          String(url).includes("/config/")
            ? {
                EnableFileAttachments: "true",
                EnableMobileFileUpload,
                MaxFileSize: "256",
                EnableCompliance: "false",
              }
            : { IsLicensed, Compliance },
        ),
    });
    expect(
      (await loadWorkspaceServerPolicy(config, undefined, "android"))
        .fileUpload,
    ).toEqual(kind === "disabled" ? { kind } : { kind, maxFileBytes: "256" });
    expect(
      (await loadWorkspaceServerPolicy(config, undefined, "desktop"))
        .fileUpload,
    ).toEqual({ kind: "enabled", maxFileBytes: "256" });
  },
);

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

test.each([
  [undefined, true],
  ["true", true],
  ["false", false],
] as const)("uses the published presence policy %s", (value, expected) => {
  expect(
    workspaceServerPolicy({ EnableUserStatuses: value }, {})
      .userStatusesEnabled,
  ).toBe(expected);
});

test.each(["false", "TRUE", "", undefined])(
  "only explicit true enables cross-team search (%s)",
  (value) => {
    expect(
      workspaceServerPolicy({ EnableCrossTeamSearch: value }, {}).search
        ?.allTeams,
    ).toBe(false);
  },
);

test.each([
  [undefined, undefined, undefined, false, true],
  ["true", undefined, "false", true, false],
  ["true", "false", undefined, false, true],
  ["false", "true", "true", false, true],
  ["true", "true", undefined, true, true],
  ["true", "unexpected", "unexpected", false, false],
] as const)(
  "uses the published search settings (%s, %s, %s)",
  (uploads, search, archived, files, archivedChannels) => {
    expect(
      workspaceServerPolicy(
        {
          EnableFileAttachments: uploads,
          EnableFileSearch: search,
          ExperimentalViewArchivedChannels: archived,
        },
        {},
      ).search,
    ).toEqual({ allTeams: false, files, archivedChannels });
  },
);

test("a malformed cross-team setting rejects the refresh", async () => {
  const config = new Configuration({
    basePath,
    fetchApi: async (url) =>
      Response.json(
        String(url).includes("/config/") ? { EnableCrossTeamSearch: true } : {},
      ),
  });
  await expect(loadWorkspaceServerPolicy(config)).rejects.toThrow(TypeError);
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

test.each([
  ["true", "1", "1"],
  ["true", "-1", "-1"],
  ["true", undefined, undefined],
  [undefined, "1", undefined],
  ["false", "1", "-1"],
  ["false", undefined, "-1"],
] as const)(
  "projects the edit window for license %s and limit %s",
  (licensed, limit, expected) => {
    const result = workspaceServerPolicy(
      { PostEditTimeLimit: limit },
      { IsLicensed: licensed },
    );
    expect(result.postEditLimitSeconds).toBe(expected);
    expect(Object.hasOwn(result, "postEditLimitSeconds")).toBe(
      expected !== undefined,
    );
  },
);

test.each([
  "",
  "01",
  "-0",
  "+1",
  "1.5",
  "1\n",
  "9223372036854775808",
  "-9223372036854775809",
])(
  "rejects malformed edit policy %j even for an unlicensed server",
  (limit) => {
    expect(() =>
      workspaceServerPolicy(
        { PostEditTimeLimit: limit },
        { IsLicensed: "false" },
      ),
    ).toThrow(TypeError);
  },
);

test("rejects invalid edit-limit wire types before publishing policy", async () => {
  for (const value of [null, 0, true]) {
    const fetchApi: typeof fetch = async (url) =>
      Response.json(
        String(url).includes("/config/")
          ? { PostEditTimeLimit: value }
          : { IsLicensed: "true" },
      );
    await expect(
      loadWorkspaceServerPolicy(new Configuration({ basePath, fetchApi })),
    ).rejects.toThrow(TypeError);
  }
});

test("compares integer milliseconds with the creation time and expires at the cutoff", () => {
  const policy = (limit: string) =>
    workspaceServerPolicy({ PostEditTimeLimit: limit }, { IsLicensed: "true" });
  expect(postEditWindow(null, 1000, 1001)).toBe("unknown");
  expect(postEditWindow(workspaceServerPolicy({}, {}), 1000, 1001)).toBe(
    "unknown",
  );
  expect(postEditWindow(policy("2"), 1000, 2999)).toBe("open");
  expect(postEditWindow(policy("2"), 1000, 3000)).toBe("expired");
  expect(postEditWindow(policy("2"), 1000, 3001)).toBe("expired");
  expect(postEditWindow(policy("0"), 1000, 1000)).toBe("expired");
  expect(postEditWindow(policy("-2"), 1000, 1000)).toBe("expired");
  expect(postEditWindow(policy("-1"), 1000, Number.MAX_SAFE_INTEGER)).toBe(
    "open",
  );
  expect(
    postEditWindow(
      policy("9223372036854775807"),
      1000,
      Number.MAX_SAFE_INTEGER,
    ),
  ).toBe("open");
  expect(
    postEditWindow(policy("-9223372036854775808"), Number.MAX_SAFE_INTEGER, 0),
  ).toBe("expired");
  expect(
    postEditWindow(
      policy("1"),
      Number.MAX_SAFE_INTEGER - 999,
      Number.MAX_SAFE_INTEGER,
    ),
  ).toBe("open");
  expect(() => postEditWindow(policy("1"), NaN, 0)).toThrow(TypeError);
  expect(() => postEditWindow(policy("1"), 0, 0.5)).toThrow(TypeError);
});

test.each([
  ["any", "any"],
  ["team", "team"],
  ["ANY", "team"],
  ["unrecognized", "team"],
  [undefined, undefined],
] as const)(
  "projects the visible recipient scope for %s",
  (input, expected) => {
    expect(
      workspaceServerPolicy({ RestrictDirectMessage: input }, {})
        .dmRecipientScope,
    ).toBe(expected);
  },
);

test("an invalid event setting leaves the remaining workspace policy available from the same requests", async () => {
  const fetchApi = vi.fn<typeof fetch>(async (input) =>
    Response.json(
      String(input).includes("/config/")
        ? {
            WebsocketURL: false,
            WebsocketSecurePort: "443",
            CollapsedThreads: "always_on",
          }
        : {},
    ),
  );
  const result = await loadWorkspaceConfiguration(
    new Configuration({ basePath, fetchApi }),
  );
  expect(result.eventAddress).toEqual({ url: null, securePort: "443" });
  expect(result.server.collapsedThreads).toBe("always_on");
  expect(fetchApi).toHaveBeenCalledTimes(2);
});
