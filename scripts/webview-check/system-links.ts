import { watchSystemChannelsLinks } from "../../src/mattermost/system-channels-links.ts";

import {
  coldLink,
  signedInLinkServer,
  signInLinkServer,
  warmLink,
} from "./link-examples.ts";

export async function checkSystemLinks() {
  const session = new AbortController();
  addEventListener("pagehide", () => session.abort(), { once: true });
  let seen = 0;
  await watchSystemChannelsLinks(
    ({ href, route }) => {
      if (seen === 0) {
        if (
          href !== coldLink ||
          route?.status !== "ready" ||
          route.userId !== "Abc01234567890123456789012" ||
          route.target.serverUrl !== signedInLinkServer ||
          route.target.kind !== "permalink" ||
          route.target.team !== null ||
          route.target.postId !== "c18xpcpusjd88en1g4j7us31ur"
        ) {
          throw Error("cold link lost its installation, account or post");
        }
      } else if (seen === 1) {
        if (
          href !== warmLink ||
          route?.status !== "sign_in_required" ||
          route.target.serverUrl !== signInLinkServer ||
          route.target.kind !== "conversation" ||
          route.target.team !== "team" ||
          route.target.identifier !== "town-square"
        )
          throw Error("warm link lost its sign-in destination");
      } else {
        throw Error("duplicate external link");
      }
      seen++;
    },
    () => location.replace("/ipc-result.html?fail=system-channels-link"),
    session.signal,
  );
}
