import { invoke } from "@tauri-apps/api/core";
import { canonicalServerUrl } from "./rest-transport.ts";

export async function openNativeRestConnection(serverUrl: string) {
  const basePath = canonicalServerUrl(serverUrl);
  const rid = await invoke<number>("open_rest_connection", { basePath });
  return {
    basePath,
    rid,
    close: () => invoke<void>("close_rest_connection", { rid }),
  };
}
