import { invoke } from "@tauri-apps/api/core";
import { nativeFetch } from "./native-fetch.ts";
import { createRestTransport } from "./rest-transport.ts";
import { canonicalServerUrl } from "./server-url.ts";

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

export function openAccountRestConnection(serverUrl: string, userId: string) {
  if (typeof userId !== "string") {
    return Promise.reject(new TypeError("Missing Mattermost account ID"));
  }
  return openConnection(serverUrl, userId);
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
