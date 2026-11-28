import { expect, test } from "vitest";
import { savedChannelPermissions } from "../mattermost/channel-permissions.ts";
import { channelBookmarkAccess } from "./channel-bookmark-access.ts";

const snapshot = {
  systemRoles: "system_user",
  definitions: [
    { name: "system_user", permissions: [] },
    { name: "team_user", permissions: ["add_bookmark_public_channel"] },
    {
      name: "worker",
      permissions: [
        "edit_bookmark_private_channel",
        "delete_bookmark_public_channel",
        "order_bookmark_private_channel",
      ],
    },
  ],
};
const check = savedChannelPermissions(snapshot, "team_user");
const room = { kind: "O", roles: "worker", deleteAt: 0 };
const actions = ["add", "edit", "delete", "order"] as const;
test("each public and private action uses the corresponding role permission", () => {
  expect(
    actions.map((a) =>
      channelBookmarkAccess(check, snapshot.systemRoles, room, a),
    ),
  ).toEqual(["allowed", "denied", "allowed", "denied"]);
  expect(
    actions.map((a) =>
      channelBookmarkAccess(
        check,
        snapshot.systemRoles,
        { ...room, kind: "P" },
        a,
      ),
    ),
  ).toEqual(["denied", "allowed", "denied", "allowed"]);
  expect(
    channelBookmarkAccess(
      savedChannelPermissions(null, undefined),
      undefined,
      room,
      "add",
    ),
  ).toBe("unknown");
  expect(
    channelBookmarkAccess(
      check,
      snapshot.systemRoles,
      { ...room, roles: undefined },
      "edit",
    ),
  ).toBe("unknown");
  expect(
    channelBookmarkAccess(
      check,
      snapshot.systemRoles,
      { ...room, roles: "unloaded_role" },
      "edit",
    ),
  ).toBe("unknown");
  expect(
    channelBookmarkAccess(
      check,
      snapshot.systemRoles,
      { ...room, roles: undefined },
      "add",
    ),
  ).toBe("allowed");
});
test.each(["D", "G"])(
  "member and guest rights in %s come from membership and the actual system role",
  (kind) => {
    for (const action of actions) {
      const joined = { ...room, kind };
      expect(channelBookmarkAccess(check, "system_user", joined, action)).toBe(
        "allowed",
      );
      expect(
        channelBookmarkAccess(check, "custom system_guest", joined, action),
      ).toBe("denied");
      expect(channelBookmarkAccess(check, undefined, joined, action)).toBe(
        "unknown",
      );
      expect(channelBookmarkAccess(check, "", joined, action)).toBe("unknown");
      expect(channelBookmarkAccess(check, "custom_guest", joined, action)).toBe(
        "allowed",
      );
      expect(
        channelBookmarkAccess(
          check,
          snapshot.systemRoles,
          { ...joined, deleteAt: 1 },
          action,
        ),
      ).toBe("denied");
      expect(
        channelBookmarkAccess(check, snapshot.systemRoles, null, action),
      ).toBe("denied");
    }
  },
);
test("custom guest permissions are honored in team channels", () => {
  const guest = savedChannelPermissions(
    {
      ...snapshot,
      systemRoles: "system_guest",
      definitions: [
        ...snapshot.definitions,
        { name: "system_guest", permissions: ["edit_bookmark_public_channel"] },
      ],
    },
    "team_user",
  );
  expect(
    channelBookmarkAccess(guest, "system_guest", room, "edit", "link"),
  ).toBe("allowed");
});

test("only ordering is supported for board bookmarks", () => {
  expect(channelBookmarkAccess(check, snapshot.systemRoles, room, "add")).toBe(
    "allowed",
  );
  expect(
    channelBookmarkAccess(check, snapshot.systemRoles, room, "add", "board"),
  ).toBe("denied");
  expect(
    channelBookmarkAccess(check, snapshot.systemRoles, room, "delete", "board"),
  ).toBe("denied");
  expect(
    channelBookmarkAccess(
      check,
      snapshot.systemRoles,
      { ...room, kind: "P" },
      "edit",
      "board",
    ),
  ).toBe("denied");
  expect(
    channelBookmarkAccess(
      check,
      snapshot.systemRoles,
      { ...room, kind: "P" },
      "order",
      "board",
    ),
  ).toBe("allowed");
  expect(
    channelBookmarkAccess(
      check,
      snapshot.systemRoles,
      { ...room, kind: "P", deleteAt: 200 },
      "order",
      "board",
    ),
  ).toBe("denied");
  expect(
    channelBookmarkAccess(
      check,
      snapshot.systemRoles,
      { ...room, kind: "threads" },
      "add",
    ),
  ).toBe("denied");
});
