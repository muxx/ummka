import { expect, test, vi } from "vitest";

import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { accountMentionGroups } from "../mattermost/mention-group-reads.ts";
import { readGroupMentionAudience } from "./group-mention-audience.ts";

const id = (n: number) => String(n).padStart(26, "a");
const channel = { id: id(1), groupConstrained: false };
const team = { id: id(2), groupConstrained: false };
const policy = {
  canMentionGroups: true,
  ldapGroups: true,
  customGroups: true,
  confirmNotifications: true,
};
const group = (index: number, name: string, source = "custom") => ({
  id: id(index),
  name,
  display_name: "Display name",
  source,
  allow_reference: true,
  delete_at: 0,
  remote_id: null,
});
function count(index: number, members: number, timezones: number) {
  return {
    group_id: id(index),
    channel_member_count: members,
    channel_member_timezones_count: timezones,
  };
}
function fixture(
  reply: (url: URL, signal?: AbortSignal | null) => unknown | Promise<unknown>,
) {
  const urls: URL[] = [];
  const config = new Configuration({
    basePath: "https://chat.example.org/north",
    fetchApi: async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://chat.example.org");
      expect(url.pathname.startsWith("/north/api/v4/")).toBe(true);
      expect(init?.method).toBe("GET");
      urls.push(url);
      const result = await reply(url, init?.signal);
      return result instanceof Response ? result : Response.json(result);
    },
  });
  return { account: accountMentionGroups(config, (fn) => fn()), urls };
}

test("locates exact names after the first page and reads counts once in candidate order", async () => {
  const { account, urls } = fixture((url) => {
    if (!url.pathname.endsWith("/groups")) {
      expect(url.pathname).toBe(
        `/north/api/v4/channels/${channel.id}/member_counts_by_group`,
      );
      expect([...url.searchParams]).toEqual([["include_timezones", "true"]]);
      return [count(91, 8, 3), count(93, 0, 0)];
    }
    const params = Object.fromEntries(url.searchParams);
    expect(params.per_page).toBe("60");
    expect(params.filter_allow_reference).toBe("true");
    if (params.q === "release" && params.page === "0") {
      return Array.from({ length: 60 }, (_, i) => ({
        ...group(100 + i, `release-${i}`),
        display_name: "release",
      }));
    }
    if (params.q === "release" && params.page === "1")
      return [group(90, "release"), group(91, "release.")];
    expect(params).toMatchObject({ q: "qa.team", page: "0" });
    return [group(93, "qa.team", "ldap")];
  });
  const result = await readGroupMentionAudience(
    account,
    channel,
    null,
    ["release._", "qa.team", "release"],
    policy,
  );
  expect(result).toEqual({
    kind: "ready",
    groups: [
      { handle: "release.", members: 8, timezones: 3 },
      { handle: "qa.team", members: 0, timezones: 0 },
      { handle: "release", members: 0, timezones: 0 },
    ],
  });
  expect(urls).toHaveLength(4);
});

test.each(["channel", "team"] as const)(
  "resolves a synced scope from the %s associations",
  async (scope) => {
    const linked = group(10, "linked", "plugin_directory");
    const custom = group(11, "local");
    const { account, urls } = fixture((url) => {
      if (url.pathname === "/north/api/v4/groups")
        return [group(15, "other", "ldap"), custom];
      if (url.pathname.endsWith("/member_counts_by_group"))
        return [count(10, 6, 3), count(11, 8, 2)];
      expect([...url.searchParams].sort()).toEqual([
        ["filter_allow_reference", "true"],
        ["paginate", "false"],
      ]);
      const suffix = scope === "channel" ? "groups_by_channels" : "groups";
      expect(url.pathname).toBe(`/north/api/v4/teams/${team.id}/${suffix}`);
      return scope === "channel"
        ? {
            groups: {
              [channel.id]: [linked],
              [id(20)]: [group(15, "other", "ldap")],
            },
          }
        : { groups: [linked], total_group_count: 1 };
    });
    const result = await readGroupMentionAudience(
      account,
      { ...channel, groupConstrained: scope === "channel" },
      { ...team, groupConstrained: true },
      ["other", "linked", "local"],
      policy,
    );
    expect(result).toEqual({
      kind: "ready",
      groups: [
        { handle: "linked", members: 6, timezones: 3 },
        { handle: "local", members: 8, timezones: 2 },
      ],
    });
    expect(urls.filter((url) => url.pathname.includes("/teams/"))).toHaveLength(
      1,
    );
  },
);

test("uses empty channel associations without searching for disabled custom groups", async () => {
  const { account, urls } = fixture(() => ({
    groups: { [id(70)]: [group(9, "elsewhere", "ldap")] },
  }));
  expect(
    await readGroupMentionAudience(
      account,
      { ...channel, groupConstrained: true },
      team,
      ["elsewhere"],
      { ...policy, customGroups: false },
    ),
  ).toEqual({ kind: "ready", groups: [] });
  expect(urls).toHaveLength(1);
});

test("needs no HTTP for disabled features, plain text, or a pending directory refresh", async () => {
  const { account, urls } = fixture(() => {
    throw Error("No HTTP expected.");
  });
  for (const settings of [
    { ...policy, confirmNotifications: false },
    { ...policy, canMentionGroups: false },
    { ...policy, customGroups: false, ldapGroups: false },
  ])
    expect(
      await readGroupMentionAudience(
        account,
        channel,
        null,
        ["release"],
        settings,
      ),
    ).toEqual({ kind: "ready", groups: [] });
  expect(
    await readGroupMentionAudience(
      account,
      { id: channel.id },
      team,
      [],
      policy,
    ),
  ).toEqual({ kind: "ready", groups: [] });
  expect(
    await readGroupMentionAudience(
      account,
      { id: channel.id },
      team,
      ["x"],
      policy,
    ),
  ).toEqual({ kind: "refresh-channel" });
  expect(
    await readGroupMentionAudience(
      account,
      channel,
      { id: team.id },
      ["x"],
      policy,
    ),
  ).toEqual({ kind: "refresh-team" });
  expect(urls).toEqual([]);
});

test("rejects repeated full pages and invalid counts, and leaves HTTP errors observable", async () => {
  const repeated = fixture(() =>
    Array.from({ length: 60 }, (_, i) => group(i + 10, `prefix-${i}`)),
  );
  await expect(
    readGroupMentionAudience(
      repeated.account,
      channel,
      null,
      ["prefix"],
      policy,
    ),
  ).rejects.toThrow("did not advance");
  expect(repeated.urls).toHaveLength(2);
  for (const invalid of [
    [count(10, 2, 3)],
    [count(10, 2, 1), count(10, 2, 1)],
    [count(10, -1, 0)],
  ]) {
    const { account } = fixture((url) =>
      url.pathname.endsWith("/groups") ? [group(10, "x")] : invalid,
    );
    await expect(
      readGroupMentionAudience(account, channel, null, ["x"], policy),
    ).rejects.toThrow("member counts");
  }
  const denied = fixture(() => new Response(null, { status: 403 }));
  await expect(
    readGroupMentionAudience(denied.account, channel, null, ["x"], policy),
  ).rejects.toBeInstanceOf(ResponseError);
});

test("bounds active searches and cancels them all when the conversation changes", async () => {
  const signals: AbortSignal[] = [];
  const controller = new AbortController();
  const { account, urls } = fixture(
    (_url, signal) =>
      new Promise((_resolve, reject) => {
        if (!signal) throw Error("Search needs the caller signal.");
        signals.push(signal);
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  const result = readGroupMentionAudience(
    account,
    channel,
    null,
    ["a", "b", "c", "d", "e", "f"],
    policy,
    controller.signal,
  );
  await vi.waitFor(() => expect(signals).toHaveLength(4));
  const reason = Error("Different channel");
  controller.abort(reason);
  await expect(result).rejects.toBe(reason);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(urls).toHaveLength(4);
});
