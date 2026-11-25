import { Channel, invoke } from "@tauri-apps/api/core";
import type { loadInstallationProfile } from "./installation-profile.ts";
import { canonicalServerUrl } from "./server-url.ts";

type BrowserProvider = Awaited<
  ReturnType<typeof loadInstallationProfile>
>["ssoProviders"][number];

export async function signInWithBrowser(
  serverUrl: string,
  provider: BrowserProvider,
  onStarted: (requestId: string) => void,
): Promise<string> {
  const url = canonicalServerUrl(serverUrl);
  const channel = new Channel<string>();
  channel.onmessage = onStarted;
  return invoke<string>("sign_in_with_browser", {
    serverUrl: url,
    provider,
    onStarted: channel,
  });
}

export function cancelBrowserSignIn(requestId: string) {
  return invoke<boolean>("cancel_browser_sign_in", { requestId });
}
