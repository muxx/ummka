import type { ChannelsTarget } from "./channels-link.ts";
import { listInstallations } from "./installation-registry.ts";
import { getCurrentAccountId } from "./native-rest.ts";
import { resolveChannelsLink } from "./resolve-channels-link.ts";

export type PendingChannelsLink = {
  status: "sign_in_required";
  target: ChannelsTarget;
};

export type AccountChannelsLink =
  | PendingChannelsLink
  | { status: "ready"; target: ChannelsTarget; userId: string };

async function forCurrentAccount(
  target: ChannelsTarget,
): Promise<AccountChannelsLink> {
  const userId = await getCurrentAccountId(target.serverUrl);
  return userId === null
    ? { status: "sign_in_required", target }
    : { status: "ready", target, userId };
}

export async function routeChannelsLink(
  href: string,
): Promise<AccountChannelsLink | null> {
  const target = await resolveChannelsLink(href);
  return target === null ? null : forCurrentAccount(target);
}

export async function resumeChannelsLink(
  pending: PendingChannelsLink,
): Promise<AccountChannelsLink | null> {
  // A removed nested installation must never hand its pending link to its parent.
  const { target } = pending;
  if (!(await listInstallations()).includes(target.serverUrl)) return null;
  return forCurrentAccount(target);
}
