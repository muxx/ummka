import { invoke } from "@tauri-apps/api/core";
import {
  CommandsApi,
  Configuration,
  FilesApi,
  PostsApi,
} from "../../vendor/mattermost/index.js";
import { readCustomEmoji } from "./account-custom-emoji.ts";
import { accountDelivery } from "./account-delivery.ts";
import { atDirectoryStep } from "./account-directory-error.ts";
import { accountPostReactions } from "./account-post-reactions.ts";
import { accountSearch } from "./account-search.ts";
import { accountChannelAudience } from "./channel-audience.ts";
import {
  type ChannelRefreshRequest,
  type ChannelRefreshResult,
  refreshChannelHistory,
} from "./channel-history-refresh.ts";
import {
  fetchTeamRoleSnapshot,
  type TeamRoleSnapshot,
} from "./channel-permissions.ts";
import type { ChannelProfile } from "./channel-profiles.ts";
import { executeAccountCommand } from "./execute-account-command.ts";
import {
  type CommandIntent,
  executeSavedCommand,
} from "./execute-saved-command.ts";
import { type JoinedTeams, projectJoinedTeams } from "./joined-teams.ts";
import type {
  ChannelWindowQuery,
  LocalChannelWindow,
  LocalPost,
} from "./local-history.ts";
import { accountMentionGroups } from "./mention-group-reads.ts";
import { readFileAnchor, readPostAnchor } from "./message-anchors.ts";
import { nativeFetch } from "./native-fetch.ts";
import { loadAccountDirectory, loadTeamDirectory } from "./navigation-data.ts";
import { refreshNavigation } from "./navigation-refresh.ts";
import { createPostActivity } from "./post-activity.ts";
import { readPostDestination } from "./post-destination.ts";
import { createRestTransport } from "./rest-transport.ts";
import { canonicalServerUrl } from "./server-url.ts";
import { projectTeamSidebar, type TeamSidebar } from "./team-sidebar.ts";
import {
  loadVisibleProfiles,
  type VisibleProfileQuery,
} from "./visible-profiles.ts";

import {
  type SavedWorkspaceSettings,
  sidebarPreferences,
} from "./workspace-preferences.ts";
import { loadWorkspaceServerPolicy } from "./workspace-server.ts";

export async function getCurrentAccountId(
  serverUrl: string,
): Promise<string | null> {
  return invoke<string | null>("get_current_account_id", {
    serverUrl: canonicalServerUrl(serverUrl),
  });
}

export async function listAccountIds(serverUrl: string): Promise<string[]> {
  return invoke<string[]>("list_account_ids", {
    serverUrl: canonicalServerUrl(serverUrl),
  });
}

export async function forgetLocalAccount(
  serverUrl: string,
  userId: string,
): Promise<void> {
  return invoke<void>("forget_local_account", {
    serverUrl: canonicalServerUrl(serverUrl),
    userId,
  });
}

export function openNativeRestConnection(serverUrl: string) {
  return openConnection(serverUrl);
}

export type SavedProfiles = {
  profiles: Record<string, ChannelProfile>;
  usernames: Record<string, string>;
};

export type DraftLocation = { channelId: string; rootId?: string };
export type ComposerDraft = {
  message: string;
  revision: string | null;
  /** Present only when the cause of this empty revision is known. */
  clearedBySubmission?: boolean;
  /** The server may already have received the command from this revision. */
  commandPending?: true;
};
export type DraftSave = { kind: "saved" | "conflict"; draft: ComposerDraft };

export type AccountSignOut =
  | { status: "signed_out" }
  | { status: "unconfirmed" }
  | { status: "superseded" }
  | { status: "server_confirmed_local_removal_failed"; cause: string };

export async function openAccountRestConnection(
  serverUrl: string,
  userId: string,
) {
  if (typeof userId !== "string") {
    throw new TypeError("Missing Mattermost account ID");
  }
  const connection = await openConnection(serverUrl, userId);
  const { rid } = connection;
  const config = new Configuration(connection);
  const posts = new PostsApi(config);
  const files = new FilesApi(config);
  const activity = createPostActivity();
  let retired:
    | "unknown_connection"
    | "cancelled"
    | "session_unavailable"
    | undefined;
  function retire(reason: NonNullable<typeof retired>) {
    retired = reason;
    activity.close();
  }
  async function readWhileOpen<T>(
    read: () => Promise<T>,
    signal?: AbortSignal,
  ) {
    if (retired) throw retired;
    const result = await read();
    if (retired) throw "cancelled";
    signal?.throwIfAborted();
    return result;
  }
  const delivery = accountDelivery(rid, readWhileOpen, posts, userId, activity);
  const commands = new CommandsApi(config);
  return {
    ...connection,
    ...accountPostReactions(config, userId, readWhileOpen),
    ...accountSearch(config, readWhileOpen),
    readPostAnchor(postId: string, signal?: AbortSignal) {
      return readWhileOpen(() => readPostAnchor(posts, postId, signal), signal);
    },
    readFileAnchor(fileId: string, signal?: AbortSignal) {
      return readWhileOpen(() => readFileAnchor(files, fileId, signal), signal);
    },
    ...accountChannelAudience(config, readWhileOpen),
    ...accountMentionGroups(config, readWhileOpen),
    readSavedProfiles(query: VisibleProfileQuery) {
      return readWhileOpen(() =>
        invoke<SavedProfiles>("read_saved_profiles", { rid, query }),
      );
    },
    refreshSavedProfiles(query: VisibleProfileQuery, signal?: AbortSignal) {
      return readWhileOpen(async () => {
        const profiles = await loadVisibleProfiles(config, query, signal);
        signal?.throwIfAborted();
        if (retired) throw "cancelled";
        if (profiles.length)
          await invoke<void>("store_channel_profiles", { rid, profiles });
        signal?.throwIfAborted();
      });
    },
    readVisibleProfiles(query: VisibleProfileQuery, signal?: AbortSignal) {
      return readWhileOpen(() => loadVisibleProfiles(config, query, signal));
    },
    readCustomEmoji(emojiName: string, signal?: AbortSignal) {
      return readWhileOpen(() => readCustomEmoji(config, emojiName, signal));
    },
    readPostDestination(postId: string, signal?: AbortSignal) {
      return readWhileOpen(() => readPostDestination(posts, postId, signal));
    },
    readAccountDirectory(signal?: AbortSignal) {
      return readWhileOpen(() => loadAccountDirectory(config, userId, signal));
    },
    readJoinedTeams() {
      return readWhileOpen(() =>
        invoke<JoinedTeams | null>("read_joined_teams", { rid }),
      );
    },
    readRecentTeamSearches(teamId: string) {
      return readWhileOpen(() =>
        invoke<string[]>("read_recent_team_searches", { rid, teamId }),
      );
    },
    rememberTeamSearch(teamId: string, term: string) {
      return readWhileOpen(() =>
        invoke<boolean>("remember_team_search", { rid, teamId, term }),
      );
    },
    forgetTeamSearch(teamId: string, term: string) {
      return readWhileOpen(() =>
        invoke<void>("forget_team_search", { rid, teamId, term }),
      );
    },
    selectJoinedTeam(teamId: string) {
      return readWhileOpen(() =>
        invoke<boolean>("select_joined_team", { rid, teamId }),
      );
    },
    refreshJoinedTeams(signal?: AbortSignal) {
      return readWhileOpen(() =>
        refreshNavigation(
          signal,
          () =>
            atDirectoryStep("begin", () =>
              invoke<number>("begin_team_directory_load", { rid }),
            ),
          async () => {
            const directory = await loadAccountDirectory(
              config,
              userId,
              signal,
              atDirectoryStep,
            );
            return {
              teams: projectJoinedTeams(directory),
              preferences: await atDirectoryStep("sidebar", () =>
                sidebarPreferences(userId, directory.preferences),
              ),
            };
          },
          (load, data) =>
            atDirectoryStep("publish", () =>
              invoke<boolean>("store_team_directory", { rid, load, ...data }),
            ),
          (load) => invoke<void>("cancel_team_directory_load", { rid, load }),
        ),
      );
    },
    ...delivery,
    submitDraftCommand(
      location: DraftLocation & { teamId: string },
      revision: string,
      intent?: CommandIntent,
    ) {
      return readWhileOpen(() =>
        executeSavedCommand(
          commands,
          delivery.transitionDraftCommand,
          location,
          revision,
          intent,
        ),
      );
    },
    executeServerCommand(
      location: DraftLocation & { teamId: string },
      text: string,
    ) {
      return readWhileOpen(() =>
        executeAccountCommand(commands, location, text),
      );
    },
    readWorkspaceSettings() {
      return readWhileOpen(() =>
        invoke<SavedWorkspaceSettings>("read_workspace_settings", { rid }),
      );
    },
    refreshWorkspaceServerPolicy(signal?: AbortSignal) {
      return readWhileOpen(() =>
        refreshNavigation(
          signal,
          () => invoke<number>("begin_workspace_policy_load", { rid }),
          () => loadWorkspaceServerPolicy(config, signal),
          (load, server) =>
            invoke<boolean>("store_workspace_policy", { rid, load, server }),
          (load) => invoke<void>("cancel_workspace_policy_load", { rid, load }),
        ),
      );
    },
    readTeamSidebar(teamId: string) {
      return readWhileOpen(() =>
        invoke<TeamSidebar | null>("read_team_sidebar", { rid, teamId }),
      );
    },
    selectSidebarChannel(teamId: string, channelId: string) {
      return readWhileOpen(() =>
        invoke<boolean>("select_sidebar_channel", { rid, teamId, channelId }),
      );
    },
    refreshTeamSidebar(teamId: string, signal?: AbortSignal) {
      return readWhileOpen(() =>
        refreshNavigation(
          signal,
          () => invoke<number | null>("begin_sidebar_load", { rid, teamId }),
          async () =>
            projectTeamSidebar(
              await loadTeamDirectory(config, userId, teamId, signal),
            ),
          (load, data) =>
            invoke<boolean>("store_team_sidebar", { rid, load, data }),
          (load) => invoke<void>("cancel_sidebar_load", { rid, load }),
        ),
      );
    },
    refreshTeamRoles(teamId: string, signal?: AbortSignal) {
      return readWhileOpen(() =>
        refreshNavigation(
          signal,
          () =>
            invoke<{ load: number; roleNames: string[] } | null>(
              "begin_team_role_load",
              { rid, teamId },
            ),
          ({ roleNames }) =>
            fetchTeamRoleSnapshot(config, userId, roleNames, signal),
          ({ load }, data) =>
            invoke<boolean>("store_team_roles", { rid, load, data }),
          ({ load }) => invoke<void>("cancel_team_role_load", { rid, load }),
        ),
      );
    },
    readSavedTeamRoles(teamId: string) {
      return readWhileOpen(() =>
        invoke<TeamRoleSnapshot | null>("read_team_roles", { rid, teamId }),
      );
    },
    readTeamDirectory(teamId: string, signal?: AbortSignal) {
      return readWhileOpen(() =>
        loadTeamDirectory(config, userId, teamId, signal),
      );
    },
    refreshChannelHistory(query: ChannelRefreshRequest, signal?: AbortSignal) {
      if (retired) return Promise.reject<ChannelRefreshResult>(retired);
      return refreshChannelHistory(
        posts,
        {
          begin: (channelId) =>
            invoke<number>("begin_channel_history_load", { rid, channelId }),
          store: (load, page) =>
            invoke<ChannelRefreshResult>("store_channel_history_page", {
              rid,
              load,
              page,
            }),
          cancel: async (load) => {
            try {
              await invoke<void>("cancel_channel_history_load", { rid, load });
            } catch (error) {
              // A closed resource has already discarded all its pending loads.
              if (error !== "unknown_connection" && error !== "cancelled")
                throw error;
            }
          },
        },
        query,
        signal,
      );
    },
    close() {
      retire("unknown_connection");
      return connection.close();
    },
    readSavedPost(channelId: string, postId: string) {
      return readWhileOpen(() =>
        invoke<LocalPost | null>("read_saved_post", { rid, channelId, postId }),
      );
    },
    readChannelWindow(query: ChannelWindowQuery) {
      return readWhileOpen(() =>
        invoke<LocalChannelWindow | null>("read_channel_window", {
          rid,
          query,
        }),
      );
    },
    async signOut() {
      const result = await invoke<AccountSignOut>("sign_out_account", { rid });
      if (result.status === "server_confirmed_local_removal_failed") {
        // The server ended this session. Keep the native handle for retrying device cleanup.
        retire(retired ?? "session_unavailable");
      } else if (result.status !== "unconfirmed") {
        retire(retired === "unknown_connection" ? retired : "cancelled");
      }
      return result;
    },
    async signOutOnDevice() {
      const result = await invoke<"removed" | "superseded">(
        "sign_out_on_device",
        { rid },
      );
      retire(retired === "unknown_connection" ? retired : "cancelled");
      return result;
    },
  };
}

async function openConnection(serverUrl: string, userId?: string) {
  const transport = createRestTransport(serverUrl, (input, init) =>
    nativeFetch(rid, input, init),
  );
  const rid = await invoke<number>("open_rest_connection", {
    basePath: transport.basePath,
    userId,
  });
  return {
    ...transport,
    rid,
    close: () => invoke<void>("close_rest_connection", { rid }),
  };
}
