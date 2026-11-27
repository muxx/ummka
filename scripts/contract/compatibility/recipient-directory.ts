import assert from "node:assert/strict";
import { readConversationRecipients } from "../../../src/mattermost/conversation-recipients.ts";
import {
  Configuration,
  ResponseError,
  UsersApi,
} from "../../../vendor/mattermost/index.js";

export async function checkRecipientDirectory(
  basePath: string,
  accessToken: string,
  teamId: string,
  privateTeamId: string,
  self: { id: string; username: string },
  outsider: { id: string; username: string },
  deactivateOutsider: () => Promise<void>,
  version: string,
) {
  const signed = new Configuration({ basePath, accessToken });
  const api = new UsersApi(signed);
  const anonymous = new UsersApi(new Configuration({ basePath }));
  const list = (inTeam?: string, page = 0, perPage = 100) =>
    api.getUsers({ active: true, page, perPage, inTeam });
  const find = (
    term: string,
    teamId?: string,
    allowInactive = false,
    limit = 20,
  ) =>
    api.searchUsers({
      searchUsersRequest: { term, teamId, allowInactive, limit },
    });
  const first = await list(teamId, 0, 1);
  const second = await list(teamId, 1, 1);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0].id, second[0].id);
  assert.deepEqual(
    (await list(teamId, 0, 2)).map((p) => p.id),
    [first[0].id, second[0].id],
  );
  assert.deepEqual(await list(teamId, 500, 1), []);
  assert.ok((await list()).some((p) => p.id === outsider.id));
  assert.ok(!(await list(teamId)).some((p) => p.id === outsider.id));
  assert.deepEqual(
    (await find(self.username, teamId)).map((p) => p.id),
    [self.id],
  );
  assert.deepEqual(
    (await find(outsider.username)).map((p) => p.id),
    [outsider.id],
  );
  assert.deepEqual(await find(outsider.username, teamId), []);
  assert.deepEqual(await find("unmatchedemmkatestprofile"), []);
  assert.ok((await find("conversation-peer")).length >= 2);
  assert.equal(
    (await find("conversation-peer", undefined, false, 1)).length,
    1,
  );

  for (const scope of ["team", "any"] as const) {
    const getScope = async () => scope;
    const matches = await readConversationRecipients(
      signed,
      teamId,
      { kind: "search", term: `@${outsider.username}` },
      getScope,
    );
    assert.deepEqual(
      matches.profiles.map((p) => p.id),
      scope === "any" ? [outsider.id] : [],
    );
    assert.equal(matches.nextPage, null);
    const page = await readConversationRecipients(
      signed,
      teamId,
      { kind: "page", page: 0 },
      getScope,
    );
    assert.equal(
      page.profiles.some((profile) => profile.id === outsider.id),
      scope === "any",
    );
    assert.ok(page.profiles.some((profile) => profile.id === self.id));
    assert.equal(page.nextPage, null);
  }
  await deactivateOutsider();
  const deactivated = await readConversationRecipients(
    signed,
    teamId,
    { kind: "search", term: outsider.username },
    async () => "any",
  );
  assert.deepEqual(deactivated, { profiles: [], nextPage: null });
  assert.deepEqual(await find(outsider.username), []);
  const inactive = await find(outsider.username, undefined, true);
  assert.equal(inactive.length, 1);
  assert.equal(inactive[0].id, outsider.id);
  assert.ok(inactive[0].deleteAt && inactive[0].deleteAt > 0);
  assert.ok(!(await list()).some((p) => p.id === outsider.id));

  const rejects = (status: number) => (e: unknown) =>
    e instanceof ResponseError && e.response.status === status;
  await assert.rejects(list(privateTeamId), rejects(403));
  await assert.rejects(find(self.username, privateTeamId), rejects(403));
  await assert.rejects(find(""), rejects(400));
  await assert.rejects(anonymous.getUsers({ page: 0 }), rejects(401));
  await assert.rejects(
    anonymous.searchUsers({ searchUsersRequest: { term: self.username } }),
    rejects(401),
  );
  console.log(
    `Mattermost ${version} verified recipient directory paging, scoped and global search, empty responses, limit, deactivation, and denied reads.`,
  );
}
