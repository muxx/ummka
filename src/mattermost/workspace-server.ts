import {
  type Configuration,
  SystemApi,
} from "../../vendor/mattermost/index.js";
import {
  readClientObject,
  readStringFields,
  selectStringFields,
} from "./installation-profile.ts";
import { readDirectory } from "./navigation-data.ts";
import { workspaceServerPolicy } from "./workspace-preferences.ts";

export type AccountEventRoute = "sameInstallation" | "unsupported";

export function loadWorkspaceConfiguration(
  config: Configuration,
  signal?: AbortSignal,
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
          "MaxNotificationsPerChannel",
          "UniqueEmojiReactionLimitPerPost",
          "PostEditTimeLimit",
          "EnableConfirmNotificationsToChannel",
          "EnableCustomGroups",
          "CollapsedThreads",
          "RestrictDirectMessage",
          "EnableCrossTeamSearch",
          "EnableFileAttachments",
          "EnableFileSearch",
          "ExperimentalViewArchivedChannels",
          "FeatureFlagEnableSharedChannelsDMs",
          "ExperimentalGroupUnreadChannels",
          "TeammateNameDisplay",
          "LockTeammateNameDisplay",
        ] as const);
        return {
          policy,
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
      request((options) =>
        readStringFields(api.getClientLicenseRaw(format, options), [
          "IsLicensed",
          "LDAPGroups",
          "LockTeammateNameDisplay",
        ] as const),
      ),
    ]);
    return {
      server: workspaceServerPolicy(settings.policy, license),
      eventAddress: settings.eventAddress,
    };
  });
}

export async function loadWorkspaceServerPolicy(
  config: Configuration,
  signal?: AbortSignal,
) {
  return (await loadWorkspaceConfiguration(config, signal)).server;
}
