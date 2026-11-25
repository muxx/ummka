import { describe, expect, it } from "vitest";

import type { Group } from "../../vendor/mattermost/index.js";
import {
  groupMentionScope,
  matchGroupMentions,
} from "./group-mention-scope.ts";

const enabled = {
  canMentionGroups: true,
  ldapGroups: true,
  customGroups: true,
};
const constrained = { groupConstrained: true };
const open = { groupConstrained: false };

describe("group mention scope for delivery", () => {
  it("uses channel links first, then the owning team, then the directory", () => {
    expect(groupMentionScope(enabled, constrained, constrained)).toBe(
      "channel",
    );
    expect(groupMentionScope(enabled, constrained, open)).toBe("channel");
    expect(groupMentionScope(enabled, open, constrained)).toBe("team");
    expect(groupMentionScope(enabled, open, open)).toBe("directory");
    expect(groupMentionScope(enabled, open, null)).toBe("directory");
  });

  it("refreshes only a snapshot needed by synced groups", () => {
    expect(groupMentionScope(enabled, {}, constrained)).toBe("refresh-channel");
    expect(groupMentionScope(enabled, open, {})).toBe("refresh-team");
    expect(groupMentionScope(enabled, constrained, {})).toBe("channel");
    expect(groupMentionScope({ ...enabled, ldapGroups: false }, {}, {})).toBe(
      "directory",
    );
    expect(
      groupMentionScope({ ...enabled, canMentionGroups: false }, {}, {}),
    ).toBe("none");
    expect(
      groupMentionScope(
        { ...enabled, ldapGroups: false, customGroups: false },
        {},
        {},
      ),
    ).toBe("none");
  });
});

function group(key: string, name: string, source: string): Group {
  return {
    id: key.repeat(26),
    name,
    source,
    allowReference: true,
    deleteAt: 0,
    remoteId: null,
  };
}

const team = group("t", "team-staff", "ldap");
const channel = group("c", "channel-staff", "ldap");
const custom = group("u", "release", "custom");
const plugin = group("p", "oncall", "plugin_directory");
const groups = [team, channel, custom, plugin];
const candidates = ["team-staff", "channel-staff", "release", "oncall"];
const directory = { scope: "directory" as const, directory: groups };

describe("matching group mention candidates against the scoped directory", () => {
  it("includes only synced groups in the chosen association and globally allowed custom groups", () => {
    const rows = {
      scope: "channel" as const,
      directory: groups,
      associated: [channel, plugin],
    };
    expect(
      matchGroupMentions(candidates, enabled, rows).map((g) => g.handle),
    ).toEqual(["channel-staff", "release", "oncall"]);
    expect(
      matchGroupMentions(candidates, enabled, { ...rows, associated: [] }).map(
        (g) => g.handle,
      ),
    ).toEqual(["release"]);
    expect(
      matchGroupMentions(candidates, enabled, {
        ...rows,
        scope: "team",
        associated: [team],
      }).map((g) => g.handle),
    ).toEqual(["team-staff", "release"]);
    expect(
      matchGroupMentions(candidates, enabled, directory).map((g) => g.handle),
    ).toEqual(candidates);
  });

  it("filters permissions, sources, deleted groups and references disabled by administrators", () => {
    expect(
      matchGroupMentions(
        candidates,
        { ...enabled, canMentionGroups: false },
        directory,
      ),
    ).toEqual([]);
    expect(
      matchGroupMentions(
        candidates,
        { ...enabled, ldapGroups: false },
        directory,
      ).map((g) => g.handle),
    ).toEqual(["release"]);
    expect(
      matchGroupMentions(
        candidates,
        { ...enabled, customGroups: false },
        directory,
      ).map((g) => g.handle),
    ).toEqual(["team-staff", "channel-staff", "oncall"]);
    const unavailable = [
      { ...team, deleteAt: 1 },
      { ...channel, allowReference: false },
      { ...custom, source: "unknown" },
      { ...plugin, name: undefined },
    ];
    expect(
      matchGroupMentions(candidates, enabled, {
        ...directory,
        directory: unavailable,
      }),
    ).toEqual([]);
  });

  it("keeps text order and the longest complete name before trailing punctuation", () => {
    const dotted = group("d", "release.", "custom");
    const rows = { ...directory, directory: [...groups, dotted] };
    expect(
      matchGroupMentions(
        [
          "RELEASE._",
          "release",
          "release.",
          "release-plan",
          "on",
          "team-staff:",
        ],
        enabled,
        rows,
      ),
    ).toEqual([
      { id: dotted.id, handle: "release." },
      { id: custom.id, handle: "release" },
      { id: team.id, handle: "team-staff" },
    ]);
    const maxName = "x".repeat(64);
    const rowsWithMax = {
      ...directory,
      directory: [group("x", maxName, "ldap")],
    };
    expect(
      matchGroupMentions(
        [`${maxName}y`, maxName + ".".repeat(5000)],
        enabled,
        rowsWithMax,
      ),
    ).toEqual([{ id: "x".repeat(26), handle: maxName }]);
  });

  it("rejects a matched row with an invalid ID before requesting any member count", () => {
    const broken = { ...directory, directory: [{ ...custom, id: "short" }] };
    expect(() => matchGroupMentions(["release"], enabled, broken)).toThrow(
      "Invalid Mattermost group ID",
    );
    expect(matchGroupMentions([], enabled, broken)).toEqual([]);
  });
});
