import assert from "node:assert/strict";
import { channelUploadCapability } from "../../../src/channels/channel-upload-policy.ts";
import {
  fetchTeamRoleSnapshot,
  savedChannelPermissions,
} from "../../../src/mattermost/channel-permissions.ts";
import { loadTeamDirectory } from "../../../src/mattermost/navigation-data.ts";
import { projectTeamSidebar } from "../../../src/mattermost/team-sidebar.ts";
import { loadWorkspaceServerPolicy } from "../../../src/mattermost/workspace-server.ts";
import {
  Configuration,
  RolesApi,
  SystemApi,
  TeamsApi,
} from "../../../vendor/mattermost/index.js";

export async function checkChannelUploadPolicy(
  basePath: string,
  adminToken: string,
  member: { id: string; token: string },
  teamId: string,
  destinations: Record<"P" | "D" | "G", string>,
  version: string,
) {
  const config = new Configuration({ basePath, accessToken: member.token });
  const adminHeaders = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
  function patch(route: string, value: unknown) {
    return fetch(`${basePath}/api/v4/${route}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify(value),
    });
  }
  const [directory, memberships, roles, original] = await Promise.all([
    loadTeamDirectory(config, member.id, teamId),
    new TeamsApi(config).getTeamMembersForUser({ userId: "me" }),
    new RolesApi(config).getRolesByNames({
      requestBody: ["system_user", "team_user", "channel_user"],
    }),
    fetch(`${basePath}/api/v4/config`, { headers: adminHeaders }).then(
      (response) => {
        assert.equal(response.status, 200);
        return response.json();
      },
    ),
  ]);
  const teamRoles = memberships.find((row) => row.teamId === teamId)?.roles;
  assert.ok(teamRoles);
  assert.ok(teamRoles.split(" ").includes("team_user"));
  const sidebar = projectTeamSidebar(directory);
  const channels = Object.entries(destinations).map(([kind, id]) => {
    const channel = sidebar.channels.find((row) => row.id === id);
    assert.ok(channel?.roles, kind);
    assert.ok(channel.roles.split(" ").includes("channel_user"), kind);
    assert.equal(channel.kind, kind);
    return { ...channel, roles: channel.roles };
  });
  assert.ok(roles);
  assert.equal(roles.length, 3);
  const includesFileSearch = version === "12.1.0";
  function settings(
    limit: number,
    enabled: boolean,
    mobile: boolean,
    fileSearch = false,
  ) {
    return patch("config/patch", {
      FileSettings: {
        MaxFileSize: limit,
        EnableFileAttachments: enabled,
        EnableMobileUpload: mobile,
      },
      ...(includesFileSearch && {
        ServiceSettings: { EnableFileSearch: fileSearch },
      }),
    });
  }
  const setGrant = async (grant: string | undefined) => {
    for (const { id, name, permissions } of roles) {
      assert.ok(id && name && permissions);
      const values = permissions.filter((value) => value !== "upload_file");
      if (name === grant) values.push("upload_file");
      const response = await patch(`roles/${id}/patch`, {
        permissions: values,
      });
      assert.equal(response.status, 200, `${name}: ${await response.text()}`);
    }
  };
  const readAccess = async () => {
    const snapshot = await fetchTeamRoleSnapshot(
      config,
      member.id,
      [
        ...teamRoles.split(" "),
        ...channels.flatMap((channel) => channel.roles.split(" ")),
      ].filter(Boolean),
    );
    assert.equal(snapshot.systemRoles, "system_user");
    return savedChannelPermissions(snapshot, teamRoles);
  };
  async function upload(
    channel: string,
    size: number,
    status: number,
    error?: string,
  ) {
    const form = new FormData();
    form.set("channel_id", channel);
    form.set("files", new Blob(["a".repeat(size)]), "upload-policy.txt");
    const response = await fetch(`${basePath}/api/v4/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${member.token}` },
      body: form,
    });
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    if (status === 201) {
      assert.equal(body.file_infos.length, 1);
      assert.equal(body.file_infos[0].size, size);
    } else if (error) {
      assert.equal(body.id, error);
    }
  }
  const limit = 256;
  try {
    assert.equal((await settings(limit, true, false)).status, 200);
    const adminConfig = await fetch(`${basePath}/api/v4/config`, {
      headers: adminHeaders,
    });
    assert.equal(adminConfig.status, 200);
    assert.equal(
      (await adminConfig.json()).FileSettings.EnableMobileUpload,
      false,
    );
    const system = new SystemApi(config);
    const mobileConfig = { format: "old" };
    const publicConfig = await (
      await system.getClientConfigRaw(mobileConfig)
    ).raw.json();
    const license = await (
      await system.getClientLicenseRaw(mobileConfig)
    ).raw.json();
    assert.equal(publicConfig.EnableMobileFileUpload, "true");
    assert.equal(license.IsLicensed, "false");
    const zero = await settings(0, true, false);
    assert.equal(zero.status, 400);
    assert.equal(
      (await zero.json()).id,
      "model.config.is_valid.max_file_size.app_error",
    );
    const server = await loadWorkspaceServerPolicy(
      config,
      undefined,
      "android",
    );
    assert.deepEqual(server.fileUpload, {
      kind: "enabled",
      maxFileBytes: String(limit),
    });
    if (includesFileSearch) assert.equal(server.search?.files, false);

    for (const grant of [
      "channel_user",
      "team_user",
      "system_user",
      undefined,
    ]) {
      await setGrant(grant);
      const access = await readAccess();
      for (const channel of channels) {
        const allowed =
          grant !== undefined &&
          (grant !== "team_user" || channel.kind === "P");
        assert.equal(
          channelUploadCapability(server, access, channel).kind,
          allowed ? "allowed" : "denied",
          `${grant} in ${channel.kind}`,
        );
        await upload(channel.id, 1, allowed ? 201 : 403);
      }
    }

    await setGrant("channel_user");
    const access = await readAccess();
    const channel = channels.find((channel) => channel.kind === "P");
    assert.ok(channel);
    const capability = channelUploadCapability(server, access, channel);
    assert.equal(capability.kind, "allowed");
    assert.equal(capability.checkSize(BigInt(limit)), "withinLimit");
    assert.equal(capability.checkSize(BigInt(limit + 1)), "tooLarge");
    await upload(channel.id, limit, 201);
    await upload(
      channel.id,
      limit + 1,
      413,
      "api.file.upload_file.too_large_detailed.app_error",
    );
    assert.equal((await settings(limit + 1, true, false)).status, 200);
    const refreshed = channelUploadCapability(
      await loadWorkspaceServerPolicy(config, undefined, "android"),
      access,
      channel,
    );
    assert.equal(refreshed.kind, "allowed");
    assert.equal(refreshed.maxFileBytes, String(limit + 1));
    assert.equal(refreshed.checkSize(BigInt(limit + 1)), "withinLimit");
    await upload(channel.id, limit + 1, 201);
    assert.equal((await settings(limit, false, false)).status, 200);
    const disabled = await loadWorkspaceServerPolicy(
      config,
      undefined,
      "android",
    );
    for (const channel of channels) {
      assert.equal(
        channelUploadCapability(disabled, access, channel).kind,
        "denied",
      );
      await upload(
        channel.id,
        1,
        403,
        "api.file.attachments.disabled.app_error",
      );
    }
  } finally {
    for (const { id, permissions } of roles) {
      const response = await patch(`roles/${id}/patch`, { permissions });
      assert.equal(response.status, 200);
    }
    const restored = await settings(
      original.FileSettings.MaxFileSize,
      original.FileSettings.EnableFileAttachments,
      original.FileSettings.EnableMobileUpload,
      original.ServiceSettings.EnableFileSearch,
    );
    assert.equal(restored.status, 200);
  }
  console.log(
    `Mattermost ${version} verified upload grants, disabled attachments and exact byte limits against member uploads. Team Edition published mobile upload enabled with the administrative switch off. A zero limit was rejected by server configuration.`,
  );
}
