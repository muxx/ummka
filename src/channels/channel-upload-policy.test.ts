import { expect, test } from "vitest";
import { savedChannelPermissions } from "../mattermost/channel-permissions.ts";
import { workspaceServerPolicy } from "../mattermost/workspace-preferences.ts";
import { channelUploadCapability } from "./channel-upload-policy.ts";

const server = workspaceServerPolicy(
  { EnableFileAttachments: "true", MaxFileSize: "9223372036854775807" },
  {},
);
const definitions = [
  { name: "plain", permissions: [] },
  { name: "uploader", permissions: ["upload_file"] },
];

test.each([
  ["uploader", "plain", "plain", "allowed", "allowed"],
  ["plain", "uploader", "plain", "allowed", "denied"],
  ["plain", "plain", "uploader", "allowed", "allowed"],
  ["plain", "plain", "plain", "denied", "denied"],
  ["plain", "missing", "plain", "unknown", "denied"],
  ["plain", "plain", undefined, "unknown", "unknown"],
] as const)(
  "checks upload grants from system %s, team %s and channel %s",
  (systemRoles, teamRoles, roles, inTeam, outsideTeam) => {
    const permission = savedChannelPermissions(
      { systemRoles, definitions },
      teamRoles,
    );
    for (const kind of ["P", "O", "D", "G"] as const) {
      expect(
        channelUploadCapability(server, permission, { kind, roles }).kind,
      ).toBe(kind === "P" || kind === "O" ? inTeam : outsideTeam);
    }
  },
);

test("disabled attachments deny even without roles while missing settings or roles stay unknown", () => {
  const missing = savedChannelPermissions(null, undefined);
  const disabled = workspaceServerPolicy(
    { EnableFileAttachments: "false" },
    {},
  );
  expect(channelUploadCapability(disabled, missing)).toEqual({
    kind: "denied",
  });
  expect(
    channelUploadCapability(server, missing, { kind: "P", roles: "plain" }),
  ).toEqual({ kind: "unknown" });
  const grant = savedChannelPermissions(
    { systemRoles: "uploader", definitions },
    "plain",
  );
  expect(
    channelUploadCapability(null, grant, { kind: "P", roles: "plain" }),
  ).toEqual({ kind: "unknown" });
  expect(channelUploadCapability(server, grant)).toEqual({ kind: "unknown" });
});

test("reuses the exact limit for a batch and leaves unknown length to the transport", () => {
  const permission = savedChannelPermissions(
    { systemRoles: "plain", definitions },
    "plain",
  );
  const channel = { kind: "P" as const, roles: "uploader" };
  const capability = channelUploadCapability(server, permission, channel);
  if (capability.kind !== "allowed") throw Error("Expected upload grant");
  expect(capability.maxFileBytes).toBe("9223372036854775807");
  expect(
    [9223372036854775808n, null, 9223372036854775807n, 0n].map(
      capability.checkSize,
    ),
  ).toEqual(["tooLarge", "unmeasured", "withinLimit", "withinLimit"]);

  const zero = workspaceServerPolicy(
    { EnableFileAttachments: "true", MaxFileSize: "0" },
    {},
  );
  const refreshed = channelUploadCapability(zero, permission, channel);
  if (refreshed.kind !== "allowed") throw Error("Expected upload grant");
  expect(refreshed.maxFileBytes).toBe("0");
  expect(refreshed.checkSize(0n)).toBe("withinLimit");
  expect(refreshed.checkSize(1n)).toBe("tooLarge");
  expect(capability.checkSize(1n)).toBe("withinLimit");
});
