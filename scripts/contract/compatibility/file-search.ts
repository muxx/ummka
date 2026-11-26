import assert from "node:assert/strict";
import { openSearchResults } from "../../../src/channels/search-results-session.ts";
import { accountSearch } from "../../../src/mattermost/account-search.ts";
import { readFileAnchor } from "../../../src/mattermost/message-anchors.ts";
import {
  ChannelsApi,
  Configuration,
  FilesApi,
  PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";
import { checkMessageTarget } from "./search-target.ts";

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
  const owner = new FilesApi(session);
  async function attach(channel: string, number: number, rootId?: string) {
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
    const uploaded = await owner.getFileInfoRaw({ fileId: id });
    assert.equal(uploaded.raw.status, 200);
    const unattached = await uploaded.value();
    assert.equal(unattached.id, id);
    assert.equal(unattached.name, name);
    assert.equal(unattached.postId, undefined);
    assert.deepEqual(await readFileAnchor(owner, id), {
      fileId: id,
      channelId: channel,
      postId: null,
    });
    const post = await posts.createPost({
      createPostRequest: {
        channelId: channel,
        rootId,
        message: `Search fixture ${terms}`,
        fileIds: [id],
      },
    });
    assert.ok(post.id);
    const attached = await owner.getFileInfo({ fileId: id });
    assert.equal(attached.id, id);
    assert.equal(attached.channelId, channel);
    assert.equal(attached.postId, post.id);
    assert.deepEqual(await readFileAnchor(owner, id), {
      fileId: id,
      channelId: channel,
      postId: post.id,
    });
    return { id, postId: post.id, post, name };
  }
  const root = await posts.createPost({
    createPostRequest: { channelId, message: "File discussion" },
  });
  assert.ok(root.id);
  const first = await attach(channelId, 1, root.id);
  const attachedPost = await new PostsApi(readerSession).getPostRaw({
    postId: first.postId,
  });
  const wire = await attachedPost.raw.clone().json();
  const displayed = await attachedPost.value();
  assert.ok(!Object.hasOwn(wire.metadata, "redacted_file_count"));
  assert.equal(displayed.metadata?.redactedFileCount, undefined);
  assert.deepEqual(displayed.fileIds, [first.id]);
  assert.equal(wire.metadata.files[0].id, first.id);
  assert.equal(displayed.metadata?.files?.[0]?.name, first.name);
  assert.equal(first.post.rootId, root.id);
  const second = await attach(other.id, 2);
  const reader = new FilesApi(readerSession);
  const anonymous = new FilesApi(
    new Configuration({ basePath: session.basePath }),
  );
  await assert.rejects(
    anonymous.getFileInfo({ fileId: first.id }),
    (error: unknown) =>
      error instanceof ResponseError && error.response.status === 401,
  );
  await assert.rejects(
    reader.getFileInfo({ fileId: second.id }),
    (error: unknown) =>
      error instanceof ResponseError && error.response.status === 403,
  );
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
  const account = accountSearch(readerSession, (read) => read());
  const query = {
    teamId: null,
    terms,
    page: 0,
    isOrSearch: false,
    includeDeletedChannels: false,
    timeZoneOffsetSeconds: 0,
  };
  const visible = await account.readFileSearchPage(query);
  assert.deepEqual(
    visible.items.map((item) => item.id),
    [first.id],
  );
  assert.equal(visible.isEnd, false);
  const last = await account.readFileSearchPage({ ...query, page: 1 });
  assert.deepEqual(last.items, []);
  assert.equal(last.isEnd, true);
  const results = openSearchResults(account, query);
  await results.select("posts");
  const postTab = results.getSnapshot().posts;
  assert.deepEqual(
    postTab.items.map((item) => item.id),
    [first.postId],
  );
  await results.select("files");
  assert.deepEqual(
    results.getSnapshot().files.items.map((item) => item.id),
    [first.id],
  );
  await results.more();
  assert.equal(results.getSnapshot().files.isEnd, true);
  await results.select("posts");
  assert.equal(results.getSnapshot().posts, postTab);
  await results.more();
  assert.equal(results.getSnapshot().posts.isEnd, true);
  results.close();
  await checkMessageTarget(
    readerSession,
    first.id,
    postTab.items[0].id,
    first.post,
    teamId,
  );
  console.log(
    `Mattermost ${version} file search verified two attached files, team scopes, viewer access and empty results.`,
  );
}
