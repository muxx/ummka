// Persist this fixture installation before restarting so a fresh WebView can verify traces offline.
export const signInLinkServer = "https://sign-in.example.test/Sub";
export const signedInLinkServer = "https://chat.example.test/Team";
export const coldLink =
  signedInLinkServer + "/_redirect/pl/c18xpcpusjd88en1g4j7us31ur";
export const warmLink = signInLinkServer + "/team/channels/town-square";

export const deniedPost = "x".repeat(26);
export const systemRoot = "v".repeat(26);
export const systemReply = "w".repeat(26);
export type SystemPostWindowMode = "hidden" | "minimized";
export function postLinks(port: string | number) {
  const server = `https://127.0.0.1:${port}/system-post-check`;
  return {
    server,
    cold: `${server}/_redirect/pl/${systemRoot}`,
    warm: `${server}/browser/pl/${systemReply}`,
    denied: `${server}/browser/pl/${deniedPost}`,
  };
}
