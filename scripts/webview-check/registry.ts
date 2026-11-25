import { getDeviceLaunchContext } from "../../src/mattermost/device-launch.ts";
import {
  connectInstallation,
  forgetInstallation,
  listInstallations,
  readInstallationSelection,
  rememberInstallation,
  selectInstallation,
} from "../../src/mattermost/installation-registry.ts";
import {
  getCurrentAccountId,
  listAccountIds,
  openAccountRestConnection,
} from "../../src/mattermost/native-rest.ts";
import { resolveChannelsLink } from "../../src/mattermost/resolve-channels-link.ts";
import {
  resumeChannelsLink,
  routeChannelsLink,
} from "../../src/mattermost/route-channels-link.ts";
import { checkSavedTeamWindow } from "./account-team-window.tsx";
import { checkRefreshedAfterRestart } from "./channel-refresh.ts";
import { checkDraftRestore } from "./composer-drafts.ts";
import { verifyHistoryLoadsAfterRestart } from "./history-loads.ts";
import { signInLinkServer } from "./link-examples.ts";
import { checkOfflineWindows } from "./local-history.ts";
import { checkSubmissionRestore } from "./submission.ts";
import { checkSystemLinks } from "./system-links.ts";
import { checkRestoredTeamRoles } from "./team-role-storage.ts";

const first = "https://chat.example.test";
const second = "https://chat.example.test/Team";

async function checkLink(server: string, saved: boolean) {
  const target = await resolveChannelsLink(`${server}/team/messages/%40Ada`);
  if (saved) {
    if (
      target?.kind !== "conversation" ||
      target.serverUrl !== server ||
      target.team !== "team" ||
      target.route !== "messages" ||
      target.identifier !== "@Ada" ||
      target.postId !== null
    ) {
      throw Error("unexpected Channels target");
    }
  } else if (target !== null) {
    throw Error("forgotten installation still handles Channels links");
  }
}

// Each fresh host process must report the phase expected by the external runner.
export async function resumeRegistryCheck(): Promise<boolean> {
  let launch: Awaited<ReturnType<typeof getDeviceLaunchContext>>;
  try {
    launch = await getDeviceLaunchContext();
  } catch (error) {
    if (error !== "unsupported_schema") throw error;
    location.replace("/ipc-result.html?registry-unsupported");
    return true;
  }
  if (launch.status === "first_launch") return false;
  const urls = await listInstallations();
  if (urls.includes(signInLinkServer)) {
    await checkSystemLinks();
    return true;
  }
  const port = String(import.meta.env.VITE_UMMKA_CHECK_PORTS).split(",")[0];
  const root = `https://127.0.0.1:${port}`;
  await checkOfflineWindows(root);
  await verifyHistoryLoadsAfterRestart(root);
  await checkRefreshedAfterRestart(root);
  const firstId = "Abc01234567890123456789012";
  for (const base of [root, `${root}/team/chat`]) {
    if ((await listAccountIds(base)).join(",") !== firstId)
      throw Error("wrong offline account list");
    const current = await getCurrentAccountId(base);
    if (current !== firstId) throw Error("wrong current account offline");
    const recovered = await openAccountRestConnection(base, current);
    try {
      const saved = await recovered.readSavedProfiles({
        ids: [firstId],
        usernames: ["fixture"],
      });
      if (
        base === root
          ? Object.keys(saved.profiles).length !== 0
          : saved.usernames.fixture !== firstId ||
            saved.profiles[firstId]?.username !== "fixture"
      )
        throw Error("offline profile directory changed after process restart");
      await checkDraftRestore(recovered, base !== root);
      await checkRestoredTeamRoles(recovered, base !== root, firstId);
      await checkSubmissionRestore(recovered, base !== root);
      const settings = await recovered.readWorkspaceSettings();
      if (
        base === root
          ? settings.preferences !== null || settings.server !== null
          : settings.preferences?.limit !== 18 ||
            settings.preferences.composerKeys?.sendOnCtrlEnter !== true ||
            settings.preferences.composerKeys.codeBlockOnCtrlEnter !== false ||
            settings.server?.collapsedThreads !== "always_on" ||
            settings.server.sharedChannelDMs !== true ||
            settings.server.uniqueReactionLimit !== "-2" ||
            settings.server.mentions?.maxNotificationsPerChannel !==
              "9223372036854775807" ||
            settings.server.mentions.confirmNotifications ||
            !settings.server.mentions.customGroups ||
            !settings.server.mentions.ldapGroups ||
            !settings.server.lockNameFormat
      )
        throw Error(
          "offline workspace settings did not belong to the restored account",
        );
      const recent = await recovered.readRecentTeamSearches(
        "Team0123456789012345678901",
      );
      if (
        base === root
          ? recent.length !== 0
          : recent.length !== 1 || recent[0] !== "from:fixture Привет"
      )
        throw Error("Recent team searches changed after an offline restart");
      const teams = await recovered.readJoinedTeams();
      const catalog = await recovered.readTeamSidebar(
        "Team0123456789012345678901",
      );
      if (
        base === root
          ? catalog !== null
          : teams?.teams[0]?.groupConstrained !== true ||
            catalog?.selectedChannel !== "c".repeat(26) ||
            catalog.data.channels[0]?.createAt !== 90 ||
            catalog.data.channels[0]?.groupConstrained !== true ||
            catalog.data.channels[0]?.mentionCountRoot !== 2 ||
            catalog.data.channels[0]?.roles !== "channel_user custom_writer" ||
            catalog.data.categories[0]?.kind !== "managed"
      ) {
        throw Error(
          "offline channel catalog lost its account, order or selection",
        );
      }
      if (
        base === root
          ? teams !== null
          : teams?.selectedTeam !== "Team0123456789012345678901" ||
            teams.teams[0]?.name !== "fixture" ||
            teams.teams[0]?.roles !== "team_guest"
      ) {
        throw Error("wrong offline teams for restored installation");
      }
    } finally {
      await recovered.close();
    }
  }
  await checkSavedTeamWindow(`${root}/team/chat`, firstId);
  if ((await getCurrentAccountId(`${root}/team/chat/secondary`)) !== null)
    throw Error("signed-out installation has a current account offline");
  const forgotten = await openAccountRestConnection(
    `${root}/team/chat/secondary`,
    "b".repeat(26),
  ).catch((error: unknown) => error);
  if (forgotten !== "session_unavailable")
    throw Error("forgotten account restored offline");
  const message = "c18xpcpusjd88en1g4j7us31ur";
  const signedIn = await routeChannelsLink(`${second}/_redirect/pl/${message}`);
  if (
    signedIn?.status !== "ready" ||
    signedIn.userId !== firstId ||
    signedIn.target.serverUrl !== second ||
    signedIn.target.kind !== "permalink" ||
    signedIn.target.team !== null ||
    signedIn.target.postId !== message
  ) {
    throw Error("offline permalink lost its target or current account");
  }
  if (urls.length === 2 && urls[0] === first && urls[1] === second) {
    if (launch.status !== "sign_in_required" || launch.serverUrl !== first)
      throw Error("lost selected signed-out installation on restart");
    const pending = await routeChannelsLink(`${first}/team/pl/${message}`);
    if (
      pending?.status !== "sign_in_required" ||
      pending.target.serverUrl !== first ||
      pending.target.kind !== "permalink" ||
      pending.target.team !== "team" ||
      pending.target.postId !== message
    )
      throw Error("expected the original sign-in destination");
    await checkLink(first, true);
    await checkLink(second, true);
    await forgetInstallation(first);
    if ((await resumeChannelsLink(pending)) !== null)
      throw Error("a removed installation still owns a pending link");
    location.replace("/ipc-result.html?registry-removed");
  } else if (urls.length === 1 && urls[0] === second) {
    if (
      launch.status !== "ready" ||
      launch.serverUrl !== second ||
      launch.userId !== firstId
    )
      throw Error("lost selected signed-in account on restart");
    await checkLink(first, false);
    await checkLink(second, true);
    await rememberInstallation(signInLinkServer);
    location.replace("/ipc-result.html?registry-confirmed");
  } else {
    throw Error("unexpected persisted installations");
  }
  return true;
}

export async function seedRegistry() {
  await connectInstallation(second);
  await connectInstallation(first);
  const added = await readInstallationSelection();
  if (added.selected !== first) throw Error("new installation was not opened");
  await selectInstallation(second);
  await connectInstallation(first);
  const urls = await listInstallations();
  if (urls.length !== 2 || urls[0] !== first || urls[1] !== second) {
    throw Error("registry seed failed");
  }
}
