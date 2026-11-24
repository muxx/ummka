import { invoke } from "@tauri-apps/api/core";
import { nativeFetch } from "./native-fetch.ts";
import { createRestTransport } from "./rest-transport.ts";

export async function openNativeRestConnection(serverUrl: string) {
  const transport = createRestTransport(serverUrl, (input, init) =>
    nativeFetch(rid, input, init),
  );
  const rid = await invoke<number>("open_rest_connection", {
    basePath: transport.basePath,
  });
  return {
    ...transport,
    rid,
    close: () => invoke<void>("close_rest_connection", { rid }),
  };
}
