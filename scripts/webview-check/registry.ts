import {
  forgetInstallation,
  listInstallations,
  rememberInstallation,
} from "../../src/mattermost/installation-registry.ts";
import {
  getCurrentAccountId,
  listAccountIds,
  openAccountRestConnection,
} from "../../src/mattermost/native-rest.ts";
import { resolveChannelsLink } from "../../src/mattermost/resolve-channels-link.ts";

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
  let urls: string[];
  try {
    urls = await listInstallations();
  } catch (error) {
    if (error !== "unsupported_schema") throw error;
    location.replace("/ipc-result.html?registry-unsupported");
    return true;
  }
  if (urls.length === 0) return false;
  const port = String(import.meta.env.VITE_UMMKA_CHECK_PORTS).split(",")[0];
  const root = `https://127.0.0.1:${port}`;
  const firstId = "Abc01234567890123456789012";
  for (const base of [root, `${root}/team/chat`]) {
    if ((await listAccountIds(base)).join(",") !== firstId)
      throw Error("wrong offline account list");
    const current = await getCurrentAccountId(base);
    if (current !== firstId) throw Error("wrong current account offline");
    const recovered = await openAccountRestConnection(base, current);
    await recovered.close();
  }
  if ((await getCurrentAccountId(`${root}/team/chat/secondary`)) !== null)
    throw Error("signed-out installation has a current account offline");
  const forgotten = await openAccountRestConnection(
    `${root}/team/chat/secondary`,
    "b".repeat(26),
  ).catch((error: unknown) => error);
  if (forgotten !== "session_unavailable")
    throw Error("forgotten account restored offline");
  if (urls.length === 2 && urls[0] === first && urls[1] === second) {
    await checkLink(first, true);
    await checkLink(second, true);
    await forgetInstallation(first);
    location.replace("/ipc-result.html?registry-removed");
  } else if (urls.length === 1 && urls[0] === second) {
    await checkLink(first, false);
    await checkLink(second, true);
    location.replace("/ipc-result.html?registry-confirmed");
  } else {
    throw Error("unexpected persisted installations");
  }
  return true;
}

export async function seedRegistry() {
  await rememberInstallation(second);
  await rememberInstallation(first);
  const urls = await listInstallations();
  if (urls.length !== 2 || urls[0] !== first || urls[1] !== second) {
    throw Error("registry seed failed");
  }
}
