import assert from "node:assert/strict";
import { accountFollowedThreads } from "../../../src/mattermost/account-followed-threads.ts";
import {
  ChannelsApi,
  type Configuration,
  type Post,
  PostsApi,
  ResponseError,
  ThreadsApi,
  type UserThread,
} from "../../../vendor/mattermost/index.js";

const missingMembership = "app.user.get_thread_membership_for_user.not_found";
const missingThread = "app.user.get_threads_for_user.not_found";

async function expectFailure(
  action: Promise<unknown>,
  status: number,
  id: string,
) {
  const error = await action.then(
    () => assert.fail(`Expected HTTP ${status} (${id})`),
    (error: unknown) => error,
  );
  assert.ok(error instanceof ResponseError);
  assert.equal(error.response.status, status);
  assert.equal((await error.response.json()).id, id);
}

function readState(thread: UserThread | undefined) {
  assert.ok(thread);
  const { id, lastViewedAt, unreadReplies, unreadMentions } = thread;
  return { id, lastViewedAt, unreadReplies, unreadMentions };
}

export async function checkThreadObservation(
  reader: { session: Configuration; username: string },
  writer: { session: Configuration; id: string; username: string },
  outsider: Configuration,
  conversations: readonly {
    teamId: string;
    channelId: string;
    direct: boolean;
  }[],
  version: string,
) {
  const threads = new ThreadsApi(reader.session);
  const account = accountFollowedThreads(reader.session, (read) => read());
  const channels = new ChannelsApi(reader.session);
  const readerPosts = new PostsApi(reader.session);
  const author = new ThreadsApi(writer.session);
  const posts = new PostsApi(writer.session);
  const stranger = new ThreadsApi(outsider);
  for (const { teamId, channelId, direct } of conversations) {
    const create = (message: string, rootId?: string) =>
      posts.createPost({ createPostRequest: { channelId, message, rootId } });
    const selection = (post: Post) => {
      assert.ok(post.id);
      return { userId: "me", teamId, threadId: post.id };
    };
    const unmentionedRoot = await create("Root with an unmentioned reply");
    const unmentioned = selection(unmentionedRoot);
    await create("Reply without a mention", unmentioned.threadId);
    if (direct) {
      // Stock collapsed threads also follow the other participant's DM replies.
      assert.equal(
        (await threads.getUserThread(unmentioned)).id,
        unmentioned.threadId,
      );
    } else {
      await expectFailure(
        threads.getUserThread(unmentioned),
        404,
        missingMembership,
      );
    }

    const root = await create("Root for addressed thread observation");
    const scope = selection(root);
    const target = { teamId, channelId, rootId: scope.threadId };
    await expectFailure(threads.getUserThread(scope), 404, missingMembership);
    await expectFailure(
      threads.setThreadUnreadByPostId({ ...scope, postId: scope.threadId }),
      404,
      missingThread,
    );
    await expectFailure(threads.getUserThread(scope), 404, missingThread);
    await expectFailure(
      account.readFollowedThreadState(target),
      404,
      missingThread,
    );

    const reply = await create(
      `@${reader.username} Reply to mark`,
      scope.threadId,
    );
    assert.ok(reply.id && reply.createAt);
    const forbidden = "api.context.permissions.app_error";
    await expectFailure(stranger.getUserThread(scope), 403, forbidden);
    await expectFailure(
      threads.getUserThread({ ...scope, userId: writer.id }),
      403,
      forbidden,
    );
    await author.startFollowingThread(scope);
    const marked = await threads.setThreadUnreadByPostId({
      ...scope,
      postId: reply.id,
    });
    const expected = {
      id: scope.threadId,
      lastViewedAt: reply.createAt - 1,
      unreadReplies: 1,
      unreadMentions: 1,
    };
    assert.deepEqual(readState(marked), expected);
    const membership = () =>
      channels.getChannelMember({ channelId, userId: "me" });
    const following = async () => {
      const page = await readerPosts.getPostThread({
        postId: scope.threadId,
        collapsedThreads: true,
      });
      return page.posts?.[scope.threadId]?.isFollowing;
    };
    const channelBefore = await membership();
    const peerBefore = readState(await author.getUserThread(scope));
    assert.equal(await following(), true);
    assert.deepEqual(await account.readFollowedThreadState(target), {
      ...expected,
      following: true,
    });
    const compact = await threads.getUserThread({ ...scope, extended: false });
    const expandedResponse = await threads.getUserThreadRaw({
      ...scope,
      extended: true,
    });
    assert.equal(expandedResponse.raw.status, 200);
    const expanded = await expandedResponse.value();
    assert.deepEqual(await threads.getUserThread(scope), compact);
    for (const result of [compact, expanded]) {
      assert.deepEqual(readState(result), expected);
      assert.equal(result.post?.id, scope.threadId);
      assert.equal(result.post.channelId, channelId);
      assert.equal(result.post.rootId, "");
      assert.equal(result.post.deleteAt, 0);
      assert.equal(result.post.message, root.message);
      assert.deepEqual(
        result.participants?.map(({ id }) => id),
        [writer.id],
      );
    }
    assert.ok(!compact.participants?.[0]?.username);
    assert.equal(expanded.participants?.[0]?.username, writer.username);
    const followed = await threads.getUserThreads({
      userId: "me",
      teamId,
      perPage: 200,
    });
    assert.deepEqual(
      readState(followed.threads?.find((row) => row.id === scope.threadId)),
      expected,
    );
    assert.deepEqual(readState(await author.getUserThread(scope)), peerBefore);
    assert.deepEqual(await membership(), channelBefore);
    assert.equal(await following(), true);
    await threads.stopFollowingThread(scope);
    await expectFailure(threads.getUserThread(scope), 404, missingThread);
    await expectFailure(
      account.readFollowedThreadState(target),
      404,
      missingThread,
    );
  }
  console.log(
    `Mattermost ${version} verified addressed thread reads as an ordinary user in a private channel and DM, both extended modes, distinct HTTP 404s, denied access, and unchanged thread and channel state.`,
  );
  console.log(
    `Mattermost ${version} verified the account observation after marking a reply, with an active nested root in its expected channel, and preserved 404 before a reply and after unfollowing.`,
  );
}
