import assert from "node:assert/strict";
import { setThreadFollowing } from "../../../src/mattermost/thread-following.ts";
import { readThreadPage } from "../../../src/mattermost/thread-page.ts";
import {
  type Configuration,
  PostsApi,
  ThreadsApi,
} from "../../../vendor/mattermost/index.js";

async function readRoot(
  posts: PostsApi,
  channelId: string,
  rootId: string,
  collapsedThreads: boolean,
) {
  const page = await readThreadPage(posts, {
    channelId,
    rootId,
    collapsedThreads,
    direction: "down",
    perPage: 1,
  });
  assert.equal(page.kind, "page");
  return page.root;
}

export async function checkOpenThreadFollowing(
  reader: Configuration,
  author: PostsApi,
  teamId: string,
  channelId: string,
) {
  const posts = new PostsApi(reader),
    threads = new ThreadsApi(reader);
  const created = await author.createPost({
    createPostRequest: { channelId, message: "A discussion without replies" },
  });
  assert.ok(created.id);
  const rootId = created.id;
  const scope = { id: rootId, rootId: null };
  async function membership(client: PostsApi) {
    return (await readRoot(client, channelId, rootId, true)).isFollowing;
  }
  async function listed() {
    const list = await threads.getUserThreads({
      userId: "me",
      teamId,
      threadsOnly: true,
      perPage: 100,
    });
    assert(Array.isArray(list.threads) && list.threads.length < 100);
    return list.threads.some((row) => row.id === rootId);
  }
  assert.equal(await membership(posts), false);
  const authorsValue = await membership(author);
  await setThreadFollowing(threads, teamId, scope, true);
  assert.equal(await membership(posts), true);
  assert.equal(await listed(), false);
  assert.equal(await membership(author), authorsValue);
  await setThreadFollowing(threads, teamId, scope, false);
  assert.equal(await membership(posts), false);
  const reply = await posts.createPost({
    createPostRequest: {
      channelId,
      rootId,
      message: "My reply to this question",
    },
  });
  assert.equal(reply.rootId, rootId);
  assert.equal(await membership(posts), true);
  assert.equal(await listed(), true);
}

export async function checkThreadAutoFollowDisabled(
  reader: Configuration,
  author: PostsApi,
  channelIds: string[],
  configure: (
    enabled: boolean,
    collapsedThreads: "always_on" | "disabled",
  ) => Promise<Response>,
) {
  const incompatible = await configure(false, "always_on");
  assert.equal(incompatible.status, 400);
  assert.equal(
    (await incompatible.json()).id,
    "model.config.is_valid.collapsed_threads.autofollow.app_error",
  );
  async function configureMode(
    enabled: boolean,
    collapsedThreads: "always_on" | "disabled",
  ) {
    const response = await configure(enabled, collapsedThreads);
    assert.equal(response.status, 200);
    const { ServiceSettings } = await response.json();
    assert.equal(ServiceSettings.ThreadAutoFollow, enabled);
    assert.equal(ServiceSettings.CollapsedThreads, collapsedThreads);
  }
  await configureMode(false, "disabled");
  const posts = new PostsApi(reader);
  const delivered = [];
  for (const channelId of channelIds) {
    const { id: rootId } = await author.createPost({
      createPostRequest: { channelId, message: "Root in flat mode" },
    });
    assert.ok(rootId);
    const posted = await posts.createPost({
      createPostRequest: {
        channelId,
        rootId,
        message: "Answer without auto-follow",
      },
    });
    assert.equal(posted.rootId, rootId);
    assert.equal(
      (await readRoot(posts, channelId, rootId, false)).isFollowing,
      undefined,
    );
    delivered.push({ channelId, rootId });
  }
  await configureMode(true, "always_on");
  for (const { channelId, rootId } of delivered)
    assert.equal(
      (await readRoot(posts, channelId, rootId, true)).isFollowing,
      false,
    );
}
