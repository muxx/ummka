import { invoke } from "@tauri-apps/api/core";
import { Configuration, PostsApi } from "../../vendor/mattermost/index.js";
import {
  type ChannelRefreshRequest,
  type ChannelRefreshResult,
  refreshChannelHistory,
} from "./channel-history-refresh.ts";
import { type JoinedTeams, projectJoinedTeams } from "./joined-teams.ts";
import type {
  ChannelWindowQuery,
  LocalChannelWindow,
} from "./local-history.ts";
import { nativeFetch } from "./native-fetch.ts";
import { loadAccountDirectory, loadTeamDirectory } from "./navigation-data.ts";
import { createRestTransport } from "./rest-transport.ts";
import { canonicalServerUrl } from "./server-url.ts";

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
  let retired: "unknown_connection" | "cancelled" | undefined;
  async function readWhileOpen<T>(read: () => Promise<T>) {
    if (retired) throw retired;
    const result = await read();
    if (retired) throw "cancelled";
    return result;
  }
  return {
    ...connection,
    readAccountDirectory(signal?: AbortSignal) {
      return readWhileOpen(() => loadAccountDirectory(config, userId, signal));
    },
    readJoinedTeams() {
      return readWhileOpen(() =>
        invoke<JoinedTeams | null>("read_joined_teams", { rid }),
      );
    },
    selectJoinedTeam(teamId: string) {
      return readWhileOpen(() =>
        invoke<boolean>("select_joined_team", { rid, teamId }),
      );
    },
    refreshJoinedTeams(signal?: AbortSignal) {
      return readWhileOpen(async () => {
        signal?.throwIfAborted();
        const load = await invoke<number>("begin_team_directory_load", { rid });
        let teams: ReturnType<typeof projectJoinedTeams>;
        try {
          const directory = await loadAccountDirectory(config, userId, signal);
          signal?.throwIfAborted();
          teams = projectJoinedTeams(directory);
        } catch (error) {
          try {
            await invoke<void>("cancel_team_directory_load", { rid, load });
          } catch (closeError) {
            if (
              closeError !== "unknown_connection" &&
              closeError !== "cancelled"
            )
              throw closeError;
          }
          throw error;
        }
        return invoke<boolean>("store_team_directory", { rid, load, teams });
      });
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
      retired = "unknown_connection";
      return connection.close();
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
      if (result.status === "signed_out" || result.status === "superseded")
        retired ??= "cancelled";
      return result;
    },
    async signOutOnDevice() {
      const result = await invoke<"removed" | "superseded">(
        "sign_out_on_device",
        { rid },
      );
      retired ??= "cancelled";
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
