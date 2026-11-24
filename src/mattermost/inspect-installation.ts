import { loadInstallationProfile } from "./installation-profile.ts";
import { openNativeRestConnection } from "./native-rest.ts";
import { canonicalServerUrl } from "./server-url.ts";

type AddressIssue = "empty" | "protocol" | "extra-parts" | "invalid";
export class InstallationAddressError extends Error {
  readonly issue: AddressIssue;
  constructor(issue: AddressIssue) {
    super(`Invalid installation address: ${issue}`);
    this.issue = issue;
  }
}

export function enteredServerUrl(input: string): string {
  const text = input.trim();
  if (!text) throw new InstallationAddressError("empty");
  const scheme = /^[a-z][a-z\d+.-]*:\/\//iu.exec(text);
  if (scheme && scheme[0].toLowerCase() !== "https://")
    throw new InstallationAddressError("protocol");
  const authorityAndPath = scheme ? text.slice(scheme[0].length) : text;
  const authority = authorityAndPath.split("/", 1)[0];
  if (/[?#]/u.test(text) || authority.includes("@"))
    throw new InstallationAddressError("extra-parts");
  // An empty port before a slash also catches a mistyped scheme such as https:/server.
  if (authority.endsWith(":") || (!scheme && /^https?:/iu.test(text)))
    throw new InstallationAddressError("invalid");
  try {
    return canonicalServerUrl(`https://${authorityAndPath}`);
  } catch (error) {
    if (error instanceof TypeError)
      throw new InstallationAddressError("invalid");
    throw error;
  }
}

export async function inspectInstallation(input: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const serverUrl = enteredServerUrl(input);
  try {
    const connection = await openNativeRestConnection(serverUrl);
    let profile: Awaited<ReturnType<typeof loadInstallationProfile>>;
    try {
      signal?.throwIfAborted();
      profile = await loadInstallationProfile(connection, signal);
    } catch (error) {
      // Report the failed request even if its resource has already been retired.
      await connection.close().catch(() => {});
      throw error;
    }
    await connection.close();
    signal?.throwIfAborted();
    return { serverUrl, ...profile };
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
}
