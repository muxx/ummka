// Persist this fixture installation before restarting so a fresh WebView can verify traces offline.
export const signInLinkServer = "https://sign-in.example.test/Sub";
export const signedInLinkServer = "https://chat.example.test/Team";
export const coldLink =
  signedInLinkServer + "/_redirect/pl/c18xpcpusjd88en1g4j7us31ur";
export const warmLink = signInLinkServer + "/team/channels/town-square";
