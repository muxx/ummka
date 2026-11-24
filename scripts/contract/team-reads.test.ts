import assert from "node:assert/strict";
import { test } from "node:test";
import { createRestTransport } from "../../src/mattermost/rest-transport.ts";
import {
  ChannelsApi,
  Configuration,
  ResponseError,
  TeamsApi,
} from "../../vendor/mattermost/index.js";
import { listen } from "./test-server.ts";

const userId = "u".repeat(26);
const teamId = "T".repeat(26);
const channelId = "c".repeat(26);

for (const prefix of ["", "/teams/chat"]) {
  test(`reads the user's teams, channels and memberships at ${prefix || "/"}`, async (t) => {
    const requests: string[] = [];
    const responses = [
      [{ id: teamId, display_name: "Team" }],
      [{ id: channelId, name: "town-square", team_id: teamId }],
      [{ user_id: userId, channel_id: channelId }],
      [],
    ];
    const { base } = await listen(t, (req, res) => {
      assert.equal(req.method, "GET");
      assert.equal(req.headers.cookie, undefined);
      requests.push(req.url ?? "");
      const authorized =
        req.headers.authorization === "Bearer synthetic-session";
      const body = authorized ? responses.shift() : { message: "sign in" };
      assert.notEqual(body, undefined);
      res.writeHead(authorized ? 200 : 401, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify(body));
    });
    const transport = createRestTransport(base + prefix, fetch);
    const config = new Configuration({
      ...transport,
      accessToken: "synthetic-session",
    });
    const teams = await new TeamsApi(config).getTeamsForUser({ userId: "me" });
    assert.equal(teams[0]?.id, teamId);
    assert.equal(teams[0]?.displayName, "Team");
    const api = new ChannelsApi(config);
    const channels = await api.getChannelsForTeamForUser({
      userId,
      teamId,
      includeDeleted: true,
      lastDeleteAt: 123,
    });
    assert.equal(channels[0]?.teamId, teamId);
    assert.equal(channels[0]?.name, "town-square");
    assert.equal(channels[0]?.id, channelId);
    const members = await api.getChannelMembersForUser({
      userId: "me",
      teamId,
    });
    assert.equal(members[0]?.channelId, channels[0]?.id);
    assert.equal(members[0]?.userId, userId);
    assert.deepEqual(
      await api.getChannelsForTeamForUser({ userId: "me", teamId }),
      [],
    );
    await assert.rejects(
      new TeamsApi(new Configuration(transport)).getTeamsForUser({
        userId: "me",
      }),
      (e) => e instanceof ResponseError && e.response.status === 401,
    );
    assert.deepEqual(requests, [
      `${prefix}/api/v4/users/me/teams`,
      `${prefix}/api/v4/users/${userId}/teams/${teamId}/channels?include_deleted=true&last_delete_at=123`,
      `${prefix}/api/v4/users/me/teams/${teamId}/channels/members`,
      `${prefix}/api/v4/users/me/teams/${teamId}/channels`,
      `${prefix}/api/v4/users/me/teams`,
    ]);
    assert.equal(responses.length, 0);
  });
}
