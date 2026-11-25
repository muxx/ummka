import {
  type Configuration,
  SystemApi,
} from "../../vendor/mattermost/index.js";
import { readStringFields } from "./installation-profile.ts";
import { readDirectory } from "./navigation-data.ts";
import { workspaceServerPolicy } from "./workspace-preferences.ts";

export function loadWorkspaceServerPolicy(
  config: Configuration,
  signal?: AbortSignal,
) {
  return readDirectory(signal, async (request) => {
    const api = new SystemApi(config);
    const format = { format: "old" };
    const [settings, license] = await Promise.all([
      request((options) =>
        readStringFields(api.getClientConfigRaw(format, options), [
          "CollapsedThreads",
          "FeatureFlagEnableSharedChannelsDMs",
          "ExperimentalGroupUnreadChannels",
          "TeammateNameDisplay",
          "LockTeammateNameDisplay",
        ] as const),
      ),
      request((options) =>
        readStringFields(api.getClientLicenseRaw(format, options), [
          "LockTeammateNameDisplay",
        ] as const),
      ),
    ]);
    return workspaceServerPolicy(settings, license);
  });
}
