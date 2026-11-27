import { readInstallationSelection } from "./installation-registry.ts";
import { getCurrentAccountId } from "./native-rest.ts";

type DeviceLaunch =
  | { status: "first_launch" }
  | { status: "sign_in_required"; serverUrl: string; installations: string[] }
  | { status: "ready"; serverUrl: string; userId: string };

export async function getDeviceLaunchContext(): Promise<DeviceLaunch> {
  const { installations, selected } = await readInstallationSelection();
  if (selected === null) return { status: "first_launch" };
  const userId = await getCurrentAccountId(selected);
  return userId === null
    ? { status: "sign_in_required", serverUrl: selected, installations }
    : { status: "ready", serverUrl: selected, userId };
}
