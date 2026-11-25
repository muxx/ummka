import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export function respondToGroupAssociations(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  teamId: string,
  channelId: string,
) {
  const match =
    /^\/(team\/chat\/)?api\/v4\/teams\/([^/]+)\/(groups|groups_by_channels)$/.exec(
      url.pathname,
    );
  if (!match) return;
  const prefixed = Boolean(match[1]);
  const teamList = match[3] === "groups";
  assert.equal(match[2], teamId);
  assert.equal(request.method, "GET");
  assert.equal(request.headers.cookie, undefined);
  assert.equal(
    request.headers.authorization,
    prefixed
      ? "Bearer fixture-prefixed-session"
      : "Bearer fixture-root-session",
  );
  assert.deepEqual(
    Object.fromEntries(url.searchParams),
    prefixed
      ? { filter_allow_reference: "true", paginate: "false" }
      : { filter_allow_reference: "true", page: "1", per_page: "2" },
  );
  const association = {
    id: "g".repeat(26),
    name: "release-qa",
    delete_at: 0,
    display_name: "Release QA",
    source: "ldap",
    remote_id: "directory-record",
    allow_reference: true,
  };
  const result = teamList
    ? {
        groups: prefixed ? [association] : [],
        total_group_count: prefixed ? 1 : 0,
      }
    : {
        groups: prefixed
          ? {
              [channelId]: [{ ...association, scheme_admin: false }],
              ["d".repeat(26)]: [{ ...association, scheme_admin: true }],
            }
          : {},
      };
  response
    .writeHead(200, { "Content-Type": "application/json" })
    .end(JSON.stringify(result));
  return (
    (teamList ? "team-group-associations" : "channel-group-associations") +
    (prefixed ? "-all" : "-empty")
  );
}
