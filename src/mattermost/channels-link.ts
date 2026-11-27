import { canonicalServerUrl, parseHttpPathUrl } from "./server-url.ts";

export type ChannelsTarget = { serverUrl: string } & (
  | {
      kind: "conversation";
      team: string;
      route: "channels" | "messages";
      identifier: string;
      postId: string | null;
    }
  | { kind: "permalink"; team: string | null; postId: string }
  | { kind: "threads"; team: string; threadId: string | null }
);

const postIdPattern = /^[a-z0-9]{26}$/u;
const identifierPattern = /^[@a-zA-Z_0-9-][@a-zA-Z_0-9.:-]*$/u;

export function isConversationIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

// Mattermost's team model permits a hyphenated name or a pair joined by "__".
const teamNamePattern =
  /^(?:[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]+__[a-z0-9]+)$/u;
const reservedTeamPrefix =
  /^(?:admin|api|channel|claim|error|files|help|landing|login|mfa|oauth|plug|post|signup|boards|playbooks)/u;

export function parseChannelsLink(
  serverUrl: string,
  href: string,
): ChannelsTarget | null {
  const base = canonicalServerUrl(serverUrl);
  const url = parseHttpPathUrl(href);
  const prefix = `${base}/`;
  if (!url?.href.startsWith(prefix)) {
    return null;
  }
  const path = url.href.slice(prefix.length).replace(/\/$/u, "");
  const segments = path.split("/");
  if (segments.length > 4) {
    return null;
  }
  let parts: string[];
  try {
    parts = segments.map(decodeURIComponent);
  } catch {
    return null;
  }
  const [team, route, identifier, postId] = parts;
  const usesSessionTeam = team === "_redirect" && route === "pl";
  // The WebApp mounts its workspace setup page before its team router.
  if (
    !usesSessionTeam &&
    (team.length > 64 ||
      !teamNamePattern.test(team) ||
      reservedTeamPrefix.test(team) ||
      team === "preparing-workspace")
  ) {
    return null;
  }
  if (route === "channels" || route === "messages") {
    if (
      !identifier ||
      !isConversationIdentifier(identifier) ||
      (postId !== undefined && !postIdPattern.test(postId))
    ) {
      return null;
    }
    return {
      kind: "conversation",
      serverUrl: base,
      team,
      route,
      identifier,
      postId: postId ?? null,
    };
  }
  if (
    postId !== undefined ||
    (identifier !== undefined && !postIdPattern.test(identifier))
  ) {
    return null;
  }
  if (route === "pl" && identifier) {
    return {
      kind: "permalink",
      serverUrl: base,
      team: usesSessionTeam ? null : team,
      postId: identifier,
    };
  }
  if (route === "threads") {
    return {
      kind: "threads",
      serverUrl: base,
      team,
      threadId: identifier ?? null,
    };
  }
  return null;
}
