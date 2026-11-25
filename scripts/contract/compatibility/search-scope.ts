import assert from "node:assert/strict";
import { loadWorkspaceServerPolicy } from "../../../src/mattermost/workspace-server.ts";
import { Configuration, SystemApi } from "../../../vendor/mattermost/index.js";

export async function checkSearchScopePolicy(
  base: string,
  adminToken: string,
  memberToken: string,
  version: string,
) {
  const member = new Configuration({
    basePath: base,
    accessToken: memberToken,
  });
  const system = new SystemApi(member);
  const raw = await (
    await system.getClientConfigRaw({ format: "old" })
  ).raw.json();
  const legacy = version === "10.10.1";
  assert.equal(Object.hasOwn(raw, "ExperimentalViewArchivedChannels"), legacy);
  assert.equal(Object.hasOwn(raw, "EnableFileSearch"), !legacy);
  function flag(name: string) {
    assert.ok(["true", "false"].includes(raw[name]), name);
    return raw[name] === "true";
  }
  const original = {
    allTeams: flag("EnableCrossTeamSearch"),
    attachments: flag("EnableFileAttachments"),
    fileSearch: !legacy && flag("EnableFileSearch"),
    archivedChannels: !legacy || flag("ExperimentalViewArchivedChannels"),
  };
  async function configure(settings: typeof original) {
    const response = await fetch(`${base}/api/v4/config/patch`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ServiceSettings: {
          EnableCrossTeamSearch: settings.allTeams,
          ...(!legacy && { EnableFileSearch: settings.fileSearch }),
        },
        FileSettings: { EnableFileAttachments: settings.attachments },
        ...(legacy && {
          TeamSettings: {
            ExperimentalViewArchivedChannels: settings.archivedChannels,
          },
        }),
      }),
    });
    assert.equal(response.status, 200);
  }
  try {
    for (const [allTeams, attachments, fileSearch, archivedChannels] of [
      [false, true, false, false],
      [true, false, true, true],
      [true, true, true, true],
    ] as const) {
      await configure({ allTeams, attachments, fileSearch, archivedChannels });
      assert.deepEqual((await loadWorkspaceServerPolicy(member)).search, {
        allTeams,
        files: attachments && (legacy || fileSearch),
        archivedChannels: !legacy || archivedChannels,
      });
    }
  } finally {
    await configure(original);
  }
}
