import {
  type Configuration,
  SystemApi,
} from "../../vendor/mattermost/index.js";
import {
  readClientObject,
  selectStringFields,
} from "./installation-profile.ts";
import { readDirectory } from "./navigation-data.ts";
import {
  type WorkspacePolicyPlatform,
  workspaceServerPolicy,
} from "./workspace-preferences.ts";

export type AccountEventRoute = "sameInstallation" | "unsupported";

export function loadWorkspaceConfiguration(
  config: Configuration,
  signal?: AbortSignal,
  platform: WorkspacePolicyPlatform = "desktop",
) {
  return readDirectory(signal, async (request) => {
    const api = new SystemApi(config);
    const format = { format: "old" };
    const [settings, license] = await Promise.all([
      request(async (options) => {
        const data = await readClientObject(
          api.getClientConfigRaw(format, options),
        );
        const policy = selectStringFields(data, [
          "EnableUserStatuses",
          "MaxNotificationsPerChannel",
          "UniqueEmojiReactionLimitPerPost",
          "PostEditTimeLimit",
          "EnableConfirmNotificationsToChannel",
          "EnableCustomGroups",
          "CollapsedThreads",
          "RestrictDirectMessage",
          "EnableCrossTeamSearch",
          "EnableFileSearch",
          "ExperimentalViewArchivedChannels",
          "FeatureFlagEnableSharedChannelsDMs",
          "ExperimentalGroupUnreadChannels",
          "TeammateNameDisplay",
          "LockTeammateNameDisplay",
        ] as const);
        return {
          policy: {
            ...policy,
            EnableFileAttachments:
              typeof data.EnableFileAttachments === "string"
                ? data.EnableFileAttachments
                : undefined,
            EnableMobileFileUpload: data.EnableMobileFileUpload,
            MaxFileSize:
              typeof data.MaxFileSize === "string"
                ? data.MaxFileSize
                : undefined,
          },
          eventAddress: {
            url:
              typeof data.WebsocketURL === "string" ? data.WebsocketURL : null,
            securePort:
              typeof data.WebsocketSecurePort === "string"
                ? data.WebsocketSecurePort
                : null,
          },
        };
      }),
      request(async (options) => {
        const data = await readClientObject(
          api.getClientLicenseRaw(format, options),
        );
        return {
          ...selectStringFields(data, [
            "IsLicensed",
            "LDAPGroups",
            "LockTeammateNameDisplay",
          ] as const),
          Compliance: data.Compliance,
        };
      }),
    ]);
    return {
      server: workspaceServerPolicy(settings.policy, license, platform),
      eventAddress: settings.eventAddress,
    };
  });
}

export async function loadWorkspaceServerPolicy(
  config: Configuration,
  signal?: AbortSignal,
  platform?: WorkspacePolicyPlatform,
) {
  return (await loadWorkspaceConfiguration(config, signal, platform)).server;
}
