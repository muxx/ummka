import assert from "node:assert/strict";
import { test } from "node:test";
import { createRestTransport } from "../../src/mattermost/rest-transport.ts";
import {
  ChannelsApi,
  Configuration,
  ResponseError,
  SharedChannelsApi,
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

test("changes a single team membership under the installation prefix", async (t) => {
  const member = { team_id: teamId, user_id: userId };
  const calls: {
    method?: string;
    path?: string;
    auth?: string;
    type?: string;
    body: string;
  }[] = [];
  const { base } = await listen(t, async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const add = req.method === "POST";
    calls.push({
      method: req.method,
      path: req.url,
      auth: req.headers.authorization,
      type: req.headers["content-type"],
      body: Buffer.concat(chunks).toString(),
    });
    res
      .writeHead(add ? 201 : 200, { "Content-Type": "application/json" })
      .end(JSON.stringify(add ? member : { status: "OK" }));
  });
  const api = new TeamsApi(
    new Configuration({
      ...createRestTransport(base + "/team/chat", fetch),
      accessToken: "synthetic-session",
    }),
  );
  const route = `/team/chat/api/v4/teams/${teamId}/members`;
  const target = { teamId, userId };
  const added = await api.addTeamMember({
    teamId,
    addTeamMemberRequest: target,
  });
  assert.equal(added.userId, userId);
  assert.equal(added.teamId, teamId);
  assert.equal((await api.removeTeamMember(target)).status, "OK");
  const [post, remove] = calls;
  assert.equal(calls.length, 2);
  assert.ok(post && remove);
  assert.deepEqual(
    [post.method, post.path, post.auth, post.type],
    ["POST", route, "Bearer synthetic-session", "application/json"],
  );
  assert.deepEqual(JSON.parse(post.body), member);
  assert.deepEqual(
    [remove.method, remove.path, remove.auth, remove.body],
    ["DELETE", route + "/" + userId, "Bearer synthetic-session", ""],
  );
});

test("an empty managed category map is a successful team-scoped read", async (t) => {
  const { base } = await listen(t, (req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(
      req.url,
      `/team/chat/api/v4/teams/${teamId}/channels/managed_categories`,
    );
    assert.equal(req.headers.authorization, "Bearer synthetic-session");
    res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
  });
  const api = new ChannelsApi(
    new Configuration({
      ...createRestTransport(base + "/team/chat", fetch),
      accessToken: "synthetic-session",
    }),
  );
  assert.deepEqual(await api.getManagedCategories({ teamId }), {});
});

test("reads both DM decisions without treating an unavailable operation as a refusal", async (t) => {
  const responses = [true, false];
  let requests = 0;
  const { base } = await listen(t, (req, res) => {
    requests++;
    assert.equal(req.method, "GET");
    assert.equal(
      req.url,
      `/chat/api/v4/sharedchannels/users/me/can_dm/${userId}`,
    );
    assert.equal(req.headers.authorization, "Bearer synthetic-session");
    const answer = responses.shift();
    res.writeHead(answer === undefined ? 404 : 200, {
      "content-type": "application/json",
    });
    res.end(
      JSON.stringify(
        answer === undefined
          ? { id: "api.context.404.app_error" }
          : { can_dm: answer },
      ),
    );
  });
  const api = new SharedChannelsApi(
    new Configuration({
      ...createRestTransport(`${base}/chat`, fetch),
      accessToken: "synthetic-session",
    }),
  );
  const pair = { userId: "me", otherUserId: userId };
  for (const expected of [true, false])
    assert.deepEqual(await api.canUserDirectMessage(pair), { canDm: expected });
  await assert.rejects(
    api.canUserDirectMessage(pair),
    (error: unknown) =>
      error instanceof ResponseError && error.response.status === 404,
  );
  assert.equal(requests, 3);
});
