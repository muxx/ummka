import { invoke } from "@tauri-apps/api/core";
import type {
  ChannelWindowQuery,
  LocalChannelWindow,
} from "./local-history.ts";
import { nativeFetch } from "./native-fetch.ts";
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
  let retired: "unknown_connection" | "cancelled" | undefined;
  return {
    ...connection,
    close() {
      retired = "unknown_connection";
      return connection.close();
    },
    async readChannelWindow(query: ChannelWindowQuery) {
      if (retired) return Promise.reject(retired);
      const page = await invoke<LocalChannelWindow | null>(
        "read_channel_window",
        { rid, query },
      );
      if (retired) return Promise.reject("cancelled");
      return page;
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
