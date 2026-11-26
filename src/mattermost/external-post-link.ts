import { invoke } from "@tauri-apps/api/core";

export function openExternalPostLink(href: string): Promise<void> {
  return invoke("open_external_post_link", { href });
}
