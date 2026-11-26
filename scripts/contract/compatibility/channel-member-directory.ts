import assert from "node:assert/strict";
import { readChannelMemberDirectory } from "../../../src/mattermost/channel-member-directory.ts";
import {
  Configuration,
  ResponseError,
  UsersApi,
} from "../../../vendor/mattermost/index.js";
export async function checkChannelMemberDirectory(
  base: string,
  readerToken: string,
  channelId: string,
  privateId: string,
  ownerId: string,
  readerId: string,
  username: string,
) {
  const config = new Configuration({
    basePath: base,
    accessToken: readerToken,
  });
  const page = await readChannelMemberDirectory(config, channelId, {
    kind: "page",
    page: 0,
  });
  assert.deepEqual(
    new Set(page.members.map((row) => row.profile.id)),
    new Set([ownerId, readerId]),
  );
  assert.equal(page.nextPage, null);
  const last = await readChannelMemberDirectory(config, channelId, {
    kind: "page",
    page: 1,
  });
  assert.deepEqual(last, { members: [], nextPage: null });
  const match = await readChannelMemberDirectory(config, channelId, {
    kind: "search",
    term: username,
  });
  assert.deepEqual(
    match.members.map((row) => row.profile.id),
    [ownerId],
  );
  assert.deepEqual(
    await readChannelMemberDirectory(config, channelId, {
      kind: "search",
      term: "nobody-fixture-4198",
    }),
    { members: [], nextPage: null },
  );
  await assert.rejects(
    () =>
      readChannelMemberDirectory(config, privateId, { kind: "page", page: 0 }),
    (e) => e instanceof ResponseError && e.response.status === 403,
  );
}

export async function checkChannelMemberRoles(
  base: string,
  readerToken: string,
  channelId: string,
  ownerId: string,
  readerId: string,
  outsider: { id: string; username: string },
) {
  const config = new Configuration({
    basePath: base,
    accessToken: readerToken,
  });
  const page = await readChannelMemberDirectory(config, channelId, {
    kind: "page",
    page: 0,
  });
  assert.deepEqual(
    page.members.map((m) => [m.profile.id, m.schemeAdmin]),
    [
      [ownerId, true],
      [readerId, false],
    ],
  );
  const globalMatches = await new UsersApi(config).searchUsers({
    searchUsersRequest: { term: outsider.username },
  });
  assert.ok(globalMatches.some((user) => user.id === outsider.id));
  const search = await readChannelMemberDirectory(config, channelId, {
    kind: "search",
    term: outsider.username,
  });
  assert.deepEqual(search, { members: [], nextPage: null });
}
