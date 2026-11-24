import { type ChannelsTarget, parseChannelsLink } from "./channels-link.ts";
import { listInstallations } from "./installation-registry.ts";
import { parseHttpPathUrl } from "./server-url.ts";

/** Resolve a copied Channels link against the installations currently saved on this device. */
export async function resolveChannelsLink(
  href: string,
): Promise<ChannelsTarget | null> {
  const url = parseHttpPathUrl(href);
  if (!url) return null;
  let matched = "";
  for (const base of await listInstallations()) {
    if (
      base.length > matched.length &&
      (url.href === base || url.href.startsWith(`${base}/`))
    ) {
      matched = base;
    }
  }
  return matched ? parseChannelsLink(matched, url.href) : null;
}
