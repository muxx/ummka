import {
  forgetInstallation,
  listInstallations,
  rememberInstallation,
} from "../../src/mattermost/installation-registry.ts";

const first = "https://chat.example.test";
const second = "https://chat.example.test/Team";

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
  if (urls.length === 2 && urls[0] === first && urls[1] === second) {
    await forgetInstallation(first);
    location.replace("/ipc-result.html?registry-removed");
  } else if (urls.length === 1 && urls[0] === second) {
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
