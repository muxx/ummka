import {
  type Configuration,
  PreferencesApi,
} from "../../vendor/mattermost/index.js";
import { directPartnerId } from "./channel-profiles.ts";
import type { TeamSidebar } from "./team-sidebar.ts";
import type { SidebarPreferences } from "./workspace-preferences.ts";

export async function reopenKnownConversation(
  config: Configuration,
  userId: string,
  channelId: string,
  sidebar: TeamSidebar["data"] | undefined,
  preferences: SidebarPreferences | null,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const channel = sidebar?.channels.find((entry) => entry.id === channelId);
  if (channel?.kind !== "D" && channel?.kind !== "G")
    throw new TypeError("Expected a known direct or group conversation.");

  const direct = channel.kind === "D";
  const name = direct ? directPartnerId(channel.name, userId) : channelId;
  if (!name) throw new TypeError("Invalid direct conversation participants.");
  if (direct ? preferences?.directShown[name] : preferences?.groupShown[name])
    return "alreadyShown" as const;

  const response = await new PreferencesApi(config).updatePreferencesRaw(
    {
      userId: "me",
      preference: [
        {
          userId,
          category: direct ? "direct_channel_show" : "group_channel_show",
          name,
          value: "true",
        },
        {
          userId,
          category: "channel_open_time",
          name: channelId,
          value: Date.now().toString(),
        },
      ],
    },
    { signal },
  );
  if (response.raw.status !== 200) {
    void response.raw.body?.cancel().catch(() => {});
  } else if ((await response.value())?.status === "OK") {
    return "confirmed" as const;
  }
  throw new TypeError(
    "Mattermost did not confirm the conversation visibility change.",
  );
}
