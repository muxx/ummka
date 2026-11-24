import { invoke } from "@tauri-apps/api/core";
import { canonicalServerUrl } from "./server-url.ts";

export function listInstallations(): Promise<string[]> {
  return invoke<string[]>("list_installations");
}

export async function rememberInstallation(serverUrl: string): Promise<void> {
  return invoke<void>("remember_installation", {
    serverUrl: canonicalServerUrl(serverUrl),
  });
}

export async function forgetInstallation(serverUrl: string): Promise<void> {
  return invoke<void>("forget_installation", {
    serverUrl: canonicalServerUrl(serverUrl),
  });
}
