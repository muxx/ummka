import { expect, test } from "vitest";
import {
  savedChannelPermissions,
  type TeamRoleSnapshot,
} from "../mattermost/channel-permissions.ts";
import { channelManagementAccess } from "./channel-management-access.ts";

const snapshot: TeamRoleSnapshot = {
  systemRoles: "member",
  definitions: [
    { name: "member", permissions: [] },
    { name: "private_creator", permissions: ["create_private_channel"] },
    { name: "public_creator", permissions: ["create_public_channel"] },
    { name: "lead", permissions: ["manage_team"] },
    {
      name: "console",
      permissions: ["sysconsole_write_user_management_channels"],
    },
    {
      name: "public_editor",
      permissions: [
        "manage_public_channel_properties",
        "delete_public_channel",
      ],
    },
    {
      name: "private_editor",
      permissions: [
        "manage_private_channel_properties",
        "delete_private_channel",
      ],
    },
  ],
};
const room = {
  kind: "O",
  roles: "public_editor",
  name: "announcements",
  deleteAt: 0,
};
const deniedChannelActions = {
  editProperties: "denied",
  archive: "denied",
  restore: "denied",
};

test("creation is team scoped, works before selection and checks each channel type", () => {
  const check = savedChannelPermissions(snapshot, "private_creator");
  expect(channelManagementAccess(check)).toEqual({
    createPublic: "denied",
    createPrivate: "allowed",
    ...deniedChannelActions,
  });
  expect(
    channelManagementAccess(check, { ...room, roles: "public_creator" }),
  ).toMatchObject({
    createPublic: "denied",
    createPrivate: "allowed",
  });
  expect(
    channelManagementAccess(
      savedChannelPermissions(snapshot, "public_creator"),
    ),
  ).toMatchObject({
    createPublic: "allowed",
    createPrivate: "denied",
  });
});

test.each([
  ["O", "public_editor", "allowed"],
  ["P", "private_editor", "allowed"],
  ["P", "public_editor", "denied"],
  ["O", "private_editor", "denied"],
])(
  "an active %s channel with %s rights has %s management",
  (kind, roles, expected) => {
    const check = savedChannelPermissions(snapshot, "lead");
    expect(
      channelManagementAccess(check, { ...room, kind, roles }),
    ).toMatchObject({
      editProperties: expected,
      archive: expected,
      restore: "denied",
    });
  },
);

test("the default channel can be edited and keeps its archive protection", () => {
  const check = savedChannelPermissions(snapshot, "lead");
  const town = { ...room, name: "town-square", displayName: "Главная" };
  expect(channelManagementAccess(check, town)).toMatchObject({
    editProperties: "allowed",
    archive: "denied",
    restore: "denied",
  });
  expect(
    channelManagementAccess(check, { ...town, deleteAt: 1 }),
  ).toMatchObject(deniedChannelActions);
  const other = { ...town, name: "other", displayName: "Town Square" };
  expect(channelManagementAccess(check, other).archive).toBe("allowed");
});

test("restore uses team management separately from channel deletion and the system console", () => {
  const archived = { ...room, roles: "public_editor lead", deleteAt: 1 };
  expect(
    channelManagementAccess(
      savedChannelPermissions(snapshot, "lead"),
      archived,
    ),
  ).toMatchObject({
    ...deniedChannelActions,
    restore: "allowed",
  });
  expect(
    channelManagementAccess(
      savedChannelPermissions(snapshot, "member"),
      archived,
    ),
  ).toMatchObject(deniedChannelActions);
  const systemConsole = savedChannelPermissions(
    { ...snapshot, systemRoles: "console" },
    "member",
  );
  expect(channelManagementAccess(systemConsole, archived)).toMatchObject(
    deniedChannelActions,
  );
});

test.each(["D", "G"])(
  "team management actions are absent on a %s conversation",
  (kind) => {
    const check = savedChannelPermissions(
      snapshot,
      "lead public_editor private_editor",
    );
    for (const deleteAt of [0, 1]) {
      expect(
        channelManagementAccess(check, { ...room, kind, deleteAt }),
      ).toMatchObject(deniedChannelActions);
    }
  },
);

test("missing role evidence remains unknown only for applicable actions", () => {
  const check = savedChannelPermissions(null, undefined);
  expect(channelManagementAccess(check, room)).toEqual({
    createPublic: "unknown",
    createPrivate: "unknown",
    editProperties: "unknown",
    archive: "unknown",
    restore: "denied",
  });
  expect(
    channelManagementAccess(check, { ...room, deleteAt: 1 }),
  ).toMatchObject({
    ...deniedChannelActions,
    restore: "unknown",
  });
});
