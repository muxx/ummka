import assert from "node:assert/strict";
import {
  ChannelsApi,
  type Configuration,
  FilesApi,
  PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkFileSearch(
  session: Configuration,
  readerSession: Configuration,
  authorization: Record<string, string>,
  teamId: string,
  channelId: string,
  otherTeamId: string,
  version: string,
) {
  const terms = "ummkafilefixture";
  const channels = await new ChannelsApi(session).getChannelsForTeamForUser({
    userId: "me",
    teamId: otherTeamId,
  });
  const other = channels.find((channel) => channel.name === "town-square");
  assert.ok(other?.id);
  const posts = new PostsApi(session);
  async function attach(channel: string, number: number) {
    const data = new FormData();
    const name = `${terms}-${number}.txt`;
    data.set("channel_id", channel);
    data.set(
      "files",
      new Blob(["Synthetic file search fixture."], { type: "text/plain" }),
      name,
    );
    const upload = await fetch(`${session.basePath}/api/v4/files`, {
      method: "POST",
      headers: authorization,
      body: data,
    });
    assert.equal(upload.status, 201, "Upload fixture attachment");
    const id: unknown = (await upload.json()).file_infos[0].id;
    assert.ok(typeof id === "string" && id.length === 26);
    const post = await posts.createPost({
      createPostRequest: {
        channelId: channel,
        message: "File search fixture",
        fileIds: [id],
      },
    });
    assert.ok(post.id);
    return { id, postId: post.id, name };
  }
  const first = await attach(channelId, 1);
  const second = await attach(other.id, 2);
  const owner = new FilesApi(session);
  const reader = new FilesApi(readerSession);
  const params = { terms, isOrSearch: false };
  const scope = (api: FilesApi, id: string) =>
    api.searchFiles({ teamId: id, searchFilesRequest: params });
  const all = (api: FilesApi) =>
    api.searchFilesInAllTeams({ searchFilesInAllTeamsRequest: params });
  const one = await scope(owner, teamId);
  assert.deepEqual(one.order, [first.id]);
  const info = one.fileInfos[first.id];
  assert.equal(info.name, first.name);
  assert.equal(info.extension, "txt");
  assert.equal(info.channelId, channelId);
  assert.equal(info.postId, first.postId);
  assert.equal(info.archived, false);
  assert.equal(one.nextFileInfoId, "");
  assert.equal(one.prevFileInfoId, "");
  assert.equal(one.firstInaccessibleFileTime, 0);
  assert.deepEqual((await scope(owner, otherTeamId)).order, [second.id]);
  assert.deepEqual(
    new Set((await all(owner)).order),
    new Set([first.id, second.id]),
  );
  assert.deepEqual((await all(reader)).order, [first.id]);
  await assert.rejects(
    scope(reader, otherTeamId),
    (error: unknown) =>
      error instanceof ResponseError && error.response.status === 403,
  );
  const empty = await owner.searchFilesInAllTeams({
    searchFilesInAllTeamsRequest: { ...params, terms: "ummkamissingfilename" },
  });
  assert.deepEqual(empty.order, []);
  assert.deepEqual(empty.fileInfos, {});
  console.log(
    `Mattermost ${version} file search verified two attached files, team scopes, viewer access and empty results.`,
  );
}
