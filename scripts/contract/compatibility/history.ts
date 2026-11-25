import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { latestReactionTarget } from "../../../src/channels/latest-reaction-target.ts";
import { channelHistoryPage } from "../../../src/mattermost/channel-history-page.ts";
import { channelPostChanges } from "../../../src/mattermost/channel-post-records.ts";
import {
  channelProfile,
  conversationName,
  indexChannelProfiles,
} from "../../../src/mattermost/channel-profiles.ts";
import {
  assembleFocusedHistory,
  readFocusedNeighbors,
} from "../../../src/mattermost/focused-history.ts";
import { loadVisibleProfiles } from "../../../src/mattermost/visible-profiles.ts";
import {
  ChannelsApi,
  Configuration,
  type Post,
  PostFromJSON,
  PostsApi,
  PostToJSON,
  ResponseError,
  UsersApi,
} from "../../../vendor/mattermost/index.js";
import {
  allowFixtureBrowserSignIn,
  checkBrowserSignIn,
} from "./browser-sign-in.ts";
import { checkChannelAudience } from "./channel-audience.ts";
import { checkCommands } from "./commands.ts";
import { checkEventStream } from "./event-stream.ts";
import { checkFileSearch } from "./file-search.ts";
import { verifyHistoryRefresh } from "./history-refresh.ts";
import {
  checkChannelRoster,
  checkEmptyTeamDirectory,
  checkNavigationMemberships,
} from "./memberships.ts";
import { checkMentionLimit } from "./mention-limit.ts";
import { checkMentionText } from "./mention-text.ts";
import {
  checkPostMutations,
  checkPreviouslyAcceptedPost,
} from "./post-mutations.ts";
import { checkPostSearch } from "./post-search.ts";
import { checkProfileReads } from "./profile-reads.ts";
import { checkReactionActions } from "./reaction-actions.ts";
import { checkPostReactions } from "./reactions.ts";
import { checkRoleReads } from "./role-reads.ts";
import { checkSidebarReads } from "./sidebar.ts";
import { checkSidebarCounters } from "./sidebar-counters.ts";

const base = "http://mattermost:8065";
const version = process.argv[2];
const config = await fetch(`${base}/api/v4/config/client?format=old`);
assert.equal(config.status, 200);
assert.equal((await config.json()).Version, version);

async function create(route: string, body: object, token?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${base}/api/v4/${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, `Create fixture at ${route}: HTTP ${response.status}`);
  return response;
}

const username = "history-fixture";
const password = `${randomBytes(24).toString("hex")}aA7!`;
const user = await (
  await create("users", {
    username,
    password,
    email: "history@example.test",
    position: "Fixture engineer",
  })
).json();
const login = await create("users/login", { login_id: username, password });
assert.equal(login.status, 200);
const token =
  login.headers.get("token") ?? assert.fail("Missing fixture session");
assert.equal((await login.json()).id, user.id);
const authorization = { Authorization: `Bearer ${token}` };
const me = await fetch(`${base}/api/v4/users/me`, { headers: authorization });
assert.equal(me.status, 200);
assert.equal((await me.json()).id, user.id);
const team = await (
  await create(
    "teams",
    {
      name: "fixture",
      display_name: "Fixture",
      type: "O",
      allow_open_invite: true,
    },
    token,
  )
).json();
const session = new Configuration({ basePath: base, accessToken: token });
const channels = await new ChannelsApi(session).getChannelsForTeamForUser({
  userId: "me",
  teamId: team.id,
});
const channel = channels.find((c) => c.name === "town-square");
assert.ok(channel?.id);
const channelId = channel.id;
async function message(text: string, rootId?: string) {
  return (
    await create(
      "posts",
      { channel_id: channelId, message: text, root_id: rootId },
      token,
    )
  ).json();
}
const imageUrl = "http://images.example.test:8099/sample.png";
const image = await message(`![sample](${imageUrl})`);
const root = await message("Root message");
const reply = await message("One reply", root.id);
const queries: URLSearchParams[] = [];
const posts = new PostsApi(
  new Configuration({
    basePath: base,
    accessToken: token,
    fetchApi: async (input, init) => {
      const request = new Request(input, init);
      queries.push(new URL(request.url).searchParams);
      return fetch(request);
    },
  }),
);
const page = { channelId, page: 0, perPage: 60 };
const ordinary = await posts.getPostsForChannel(page);
assert.ok(
  ordinary.order?.includes(root.id) && ordinary.order.includes(reply.id),
);
assert.equal(ordinary.posts?.[reply.id]?.rootId, root.id);
const savedById = new Map(
  channelPostChanges(channelId, ordinary)
    .filter((row) => row.kind === "save")
    .map((row) => [row.id, row]),
);
const savedInOrder = (ordinary.order ?? []).flatMap((id) => {
  const record = savedById.get(id);
  return record ? [record] : [];
});
const lastVisible = savedInOrder.find((row) => !row.type.startsWith("system_"));
assert.ok(
  lastVisible && [root.id, reply.id, image.id].includes(lastVisible.id),
);
assert.equal(latestReactionTarget(channelId, savedInOrder), lastVisible.id);
assert.equal(latestReactionTarget(channelId, savedInOrder, root.id), reply.id);
assert.equal(latestReactionTarget(channelId, savedInOrder, image.id), image.id);

assert.equal(ordinary.firstInaccessiblePostTime, 0);
const size = ordinary.posts?.[image.id]?.metadata?.images?.[imageUrl];
assert.deepEqual(size, { height: 3, width: 4, format: "png", frameCount: 0 });
assert.equal(ordinary.posts?.[image.id]?.message, image.message);
assert.equal(ordinary.posts?.[image.id]?.messageSource, undefined);

const collapsed = await posts.getPostsForChannel({
  ...page,
  collapsedThreads: true,
  collapsedThreadsExtended: true,
  skipFetchThreads: false,
});
assert.ok(
  collapsed.order?.includes(root.id) && !collapsed.order.includes(reply.id),
);
const summary = collapsed.posts?.[root.id];
assert.equal(summary?.replyCount, 1);
assert.equal(summary?.lastReplyAt, reply.create_at);
assert.equal(summary?.isFollowing, true);
assert.deepEqual(
  summary?.participants?.map((p) => p.id),
  [user.id],
);
assert.equal(collapsed.firstInaccessiblePostTime, 0);
assert.deepEqual(
  queries.map((query) => Object.fromEntries(query)),
  [
    { page: "0", per_page: "60" },
    {
      page: "0",
      per_page: "60",
      collapsedThreads: "true",
      collapsedThreadsExtended: "true",
      skipFetchThreads: "false",
    },
  ],
);
const anonymous = new PostsApi(new Configuration({ basePath: base }));
const failure = await anonymous.getPostsForChannel(page).then(
  () => assert.fail("Expected an anonymous HTTP error"),
  (error: unknown) => error,
);
assert.ok(failure instanceof ResponseError);
assert.equal(failure.response.status, 401);
const publicError = await failure.response.json();
assert.equal(publicError.status_code, 401);
for (const field of ["id", "message", "request_id"]) {
  assert.equal(typeof publicError[field], "string");
  assert.ok(publicError[field].length > 0);
}
// A public channel can be visible before joining. A DM has no team at all.
const memberPosts = new PostsApi(session);
const expectedContext = {
  channelId,
  channelType: channel.type,
  channelDisplayName: channel.displayName,
  hasJoinedChannel: true,
  teamId: team.id,
  teamType: "O",
  teamDisplayName: team.display_name,
  hasJoinedTeam: true,
};
for (const post of [root, reply])
  assert.deepEqual(
    await memberPosts.getPostInfo({ postId: post.id }),
    expectedContext,
  );

const readerLogin = {
  login_id: "context-reader",
  password: `${randomBytes(24).toString("hex")}aA7!`,
};
const reader = await (
  await create("users", {
    username: readerLogin.login_id,
    password: readerLogin.password,
    email: "reader@example.test",
  })
).json();
const readerToken = (await create("users/login", readerLogin)).headers.get(
  "token",
);
assert.ok(readerToken);
await checkRoleReads(base, readerToken, reader.id, version);
const readerPosts = new PostsApi(
  new Configuration({ basePath: base, accessToken: readerToken }),
);
const open = await readerPosts.getPostInfoRaw({ postId: root.id });
assert.equal(open.raw.status, 200);
assert.deepEqual(await open.value(), {
  ...expectedContext,
  hasJoinedChannel: false,
  hasJoinedTeam: false,
});

// The fixture administrator can view a recently created team before joining any of its channels.
const emptyTeam = await (
  await create(
    "teams",
    { name: "directory-empty", display_name: "Empty", type: "O" },
    readerToken,
  )
).json();
await checkEmptyTeamDirectory(session, user.id, emptyTeam.id);

const dm = await (
  await create("channels/direct", [user.id, reader.id], token)
).json();
const dmPost = await (
  await create("posts", { channel_id: dm.id, message: "Direct message" }, token)
).json();
const direct = await readerPosts.getPostInfo({ postId: dmPost.id });
assert.deepEqual(direct, {
  channelId: dm.id,
  channelType: "D",
  channelDisplayName: dm.display_name,
  hasJoinedChannel: true,
  teamId: "",
  teamType: "",
  teamDisplayName: "",
  hasJoinedTeam: false,
});

const closed = await (
  await create(
    "channels",
    {
      team_id: team.id,
      name: "closed-fixture",
      display_name: "Closed fixture",
      type: "P",
    },
    token,
  )
).json();
const closedPost = await (
  await create(
    "posts",
    { channel_id: closed.id, message: "Private fixture" },
    token,
  )
).json();
const closedMember = await new ChannelsApi(session).getChannelMember({
  channelId: closed.id,
  userId: "me",
});
await checkReactionActions(
  base,
  { id: user.id, token },
  { id: reader.id, token: readerToken },
  dm.id,
);
console.log(
  `Mattermost ${version} verified two users joining and leaving one reaction at the distinct emoji limit.`,
);
assert.equal(closedMember.userId, user.id);
assert.equal(closedMember.channelId, closed.id);
const closedReader = new ChannelsApi(
  new Configuration({ basePath: base, accessToken: readerToken }),
);
await checkChannelAudience(
  base,
  team.id,
  { id: dm.id, postId: dmPost.id },
  closed.id,
  { id: user.id, token },
  { id: reader.id, token: readerToken },
);
console.log(
  `Mattermost ${version} verified channel audience counts, timezones and private channel access.`,
);
await checkChannelRoster(closedReader, closed.id, dm.id, [user.id, reader.id]);
await assert.rejects(
  closedReader.getChannelMember({ channelId: closed.id, userId: user.id }),
  (e: unknown) => e instanceof ResponseError && e.response.status === 403,
);
await assert.rejects(
  new ChannelsApi(new Configuration({ basePath: base })).getChannelMember({
    channelId: closed.id,
    userId: "me",
  }),
  (e: unknown) => e instanceof ResponseError && e.response.status === 401,
);
await assert.rejects(
  readerPosts.getPostInfo({ postId: closedPost.id }),
  (e: unknown) => e instanceof ResponseError && e.response.status === 404,
);
await assert.rejects(
  anonymous.getPostInfo({ postId: root.id }),
  (e: unknown) => e instanceof ResponseError && e.response.status === 401,
);
console.log(
  `Mattermost ${version} verified post context for members, nonmembers, a DM, and private posts.`,
);

const lastReply = await message("Second reply", root.id);
const threadQuery = {
  perPage: 60,
  direction: "down",
  skipFetchThreads: false,
  collapsedThreads: false,
  collapsedThreadsExtended: false,
};
for (const post of [root, reply]) {
  const thread = await memberPosts.getPostThread({
    ...threadQuery,
    postId: post.id,
  });
  assert.deepEqual(
    thread.order,
    post.id === root.id
      ? [root.id, reply.id, lastReply.id]
      : [reply.id, root.id, lastReply.id],
  );
  assert.equal(thread.posts?.[reply.id]?.rootId, root.id);
  assert.equal(thread.posts?.[lastReply.id]?.message, "Second reply");
  assert.equal(thread.firstInaccessiblePostTime, 0);
  assert.equal(thread.hasNext, false);
}
const firstPage = await memberPosts.getPostThread({
  postId: root.id,
  perPage: 1,
  direction: "down",
});
assert.deepEqual(firstPage.order, [root.id]);
assert.equal(firstPage.hasNext, true);
const followingPage = await memberPosts.getPostThread({
  postId: root.id,
  perPage: 1,
  direction: "down",
  fromPost: reply.id,
  fromCreateAt: reply.create_at,
});
assert.deepEqual(followingPage.order, [root.id, lastReply.id]);
assert.equal(followingPage.hasNext, false);
await assert.rejects(
  memberPosts.getPostThread({ postId: root.id, updatesOnly: true }),
  (e: unknown) => e instanceof ResponseError && e.response.status === 400,
);
await assert.rejects(
  anonymous.getPostThread({ postId: root.id }),
  (e: unknown) => e instanceof ResponseError && e.response.status === 401,
);
console.log(
  `Mattermost ${version} verified thread order for root and reply, cursor pagination and thread errors.`,
);

const followingRoot = await message("Following root");
for (const collapsedThreads of [false, true]) {
  const start = queries.length;
  const thread = await posts.getPostThread({
    postId: root.id,
    collapsedThreads,
  });
  const { after, before } = await readFocusedNeighbors(posts, {
    channelId,
    anchorId: root.id,
    perPage: 1,
    collapsedThreads,
  });
  assert.equal(queries.length - start, 3);
  const focused = assembleFocusedHistory({
    anchorId: root.id,
    after,
    thread,
    before,
  });
  assert.deepEqual(focused.order, [
    collapsedThreads ? followingRoot.id : reply.id,
    root.id,
    image.id,
  ]);
  assert.equal(focused.posts?.[reply.id]?.rootId, root.id);
  assert.equal(focused.posts?.[lastReply.id]?.message, "Second reply");
  assert.ok(
    channelPostChanges(channelId, focused).some(
      (entry) =>
        entry.kind === "save" &&
        entry.id === lastReply.id &&
        entry.rootId === root.id &&
        entry.message === "Second reply",
    ),
  );
  assert.equal(focused.nextPostId, after.nextPostId);
  assert.equal(focused.prevPostId, before.prevPostId);
  assert.equal(focused.firstInaccessiblePostTime, 0);
  const focusedPage = channelHistoryPage(
    { channelId, collapsedThreads, focusedPostId: root.id },
    focused,
  );
  assert.deepEqual(focusedPage.source, { kind: "focused", postId: root.id });
  assert.deepEqual(focusedPage.order, focused.order);
  for (const direction of ["before", "after"] as const) {
    const request = {
      ...page,
      perPage: 2,
      collapsedThreads,
      [direction]: root.id,
    };
    const result = await posts.getPostsForChannel(request);
    const visible = channelHistoryPage(request, result);
    assert.deepEqual(visible.source, { kind: direction, postId: root.id });
    assert.equal(visible.collapsedThreads, collapsedThreads);
    assert.deepEqual(visible.order, result.order);
    assert.equal(visible.prevPostId, result.prevPostId);
    assert.equal(visible.nextPostId, result.nextPostId);
    if (direction === "after")
      assert.equal(
        visible.order.at(-1),
        collapsedThreads ? followingRoot.id : reply.id,
      );
    else assert.equal(visible.order[0], image.id);
  }
}
console.log(
  `Mattermost ${version} verified the focused timeline with plain and collapsed threads.`,
);

// Pin state and the server's parsed hashtags are independent properties of each post.
const plainPost = await message("An ordinary post");
const taggedPost = await message("A post with #ummkatest");
for (const pinned of [false, true]) {
  if (pinned) {
    for (const post of [plainPost, taggedPost])
      await create(`posts/${post.id}/pin`, {}, token);
  }
  const response = await posts.getPostsForChannelRaw(page);
  const raw = await response.raw.clone().json();
  const model = await response.value();
  for (const [id, tags] of [
    [plainPost.id, ""],
    [taggedPost.id, "#ummkatest"],
  ]) {
    const wire = raw.posts[id];
    assert.equal(wire.is_pinned, pinned);
    assert.equal(wire.hashtags, tags);
    assert.equal(Object.hasOwn(wire, "hashtag"), false);
    const post = model.posts?.[id];
    assert.ok(post);
    assert.deepEqual(post, PostFromJSON(wire));
    assert.equal(post.isPinned, pinned);
    assert.equal(post.hashtags, tags);
    const encoded = JSON.parse(JSON.stringify(PostToJSON(post)));
    assert.equal(encoded.is_pinned, pinned);
    assert.equal(encoded.hashtags, tags);
    assert.equal(Object.hasOwn(encoded, "hashtag"), false);
  }
}
console.log(
  `Mattermost ${version} verified independent pin and hashtag values through the generated Post converters.`,
);

// The local image proxy rewrites the displayed Markdown and keeps the author's source.
const enableProxy = await fetch(`${base}/api/v4/config/patch`, {
  method: "PUT",
  headers: { ...authorization, "Content-Type": "application/json" },
  body: JSON.stringify({ ImageProxySettings: { Enable: true } }),
});
assert.equal(enableProxy.status, 200);
const proxyPage = await posts.getPostsForChannelRaw(page);
const proxyWire = (await proxyPage.raw.clone().json()).posts;
const proxyPosts = (await proxyPage.value()).posts;
assert.ok(proxyPosts);
const proxied = new URL("/api/v4/image", base);
proxied.searchParams.set("url", imageUrl);
assert.equal(proxyWire[image.id].message, `![sample](${proxied.href})`);
assert.equal(proxyWire[image.id].message_source, image.message);
assert.equal(Object.hasOwn(proxyWire[plainPost.id], "message_source"), false);
for (const id of [image.id, plainPost.id]) {
  const post: Post = proxyPosts[id];
  assert.deepEqual(post, PostFromJSON(proxyWire[id]));
  assert.equal(post.message, proxyWire[id].message);
  assert.equal(post.messageSource, proxyWire[id].message_source);
  const encoded = JSON.parse(JSON.stringify(PostToJSON(post)));
  assert.equal(encoded.message, proxyWire[id].message);
  assert.equal(encoded.message_source, proxyWire[id].message_source);
  assert.equal(Object.hasOwn(encoded, "message_source"), id === image.id);
}
console.log(
  `Mattermost ${version} verified original Markdown across image proxy rewrites.`,
);

const projection = channelPostChanges(channelId, { posts: proxyPosts });
const imageRecord = projection.find((entry) => entry.id === image.id);
assert.ok(imageRecord?.kind === "save");
assert.equal(imageRecord.message, proxyWire[image.id].message);
assert.equal(imageRecord.messageSource, image.message);
for (const id of [plainPost.id, taggedPost.id]) {
  const entry = projection.find((change) => change.id === id);
  assert.ok(entry?.kind === "save");
  assert.equal(entry.isPinned, true);
  assert.equal(entry.hashtags, proxyWire[id].hashtags);
  assert.equal(entry.messageSource, null);
}

await create(
  `teams/${team.id}/members`,
  { team_id: team.id, user_id: reader.id },
  token,
);
const extraTeam = await (
  await create(
    "teams",
    {
      name: "roles-fixture",
      display_name: "Membership fixture",
      type: "O",
      allow_open_invite: true,
    },
    token,
  )
).json();
await checkPostSearch(
  session,
  new Configuration({ basePath: base, accessToken: readerToken }),
  team.id,
  channelId,
  extraTeam.id,
  version,
);
await checkFileSearch(
  session,
  new Configuration({ basePath: base, accessToken: readerToken }),
  authorization,
  team.id,
  channelId,
  extraTeam.id,
  version,
);
await create(
  `teams/${extraTeam.id}/members`,
  { team_id: extraTeam.id, user_id: reader.id },
  token,
);
await checkNavigationMemberships(
  new Configuration({ basePath: base, accessToken: readerToken }),
  reader.id,
  { session, userId: user.id },
  team.id,
  extraTeam.id,
  channelId,
  dm.id,
  () =>
    fetch(`${base}/api/v4/teams/${extraTeam.id}/members/${reader.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${readerToken}` },
    }),
);
console.log(
  `Mattermost ${version} verified channel and team roles, active and removed membership and anonymous HTTP 401.`,
);
await checkSidebarCounters(
  new Configuration({ basePath: base, accessToken: readerToken }),
  reader.id,
  team.id,
  channelId,
  readerLogin.login_id,
  message,
  dm.id,
  () =>
    Promise.all([
      message("A new root for the bulk read"),
      create(
        "posts",
        { channel_id: dm.id, message: "Another unread direct post" },
        token,
      ),
    ]),
);
console.log(
  `Mattermost ${version} verified root and reply counters through a channel view.`,
);
// The earlier non-member checks use this private channel before the reader joins.
await create(`channels/${closed.id}/members`, { user_id: reader.id }, token);
await checkSidebarReads(
  base,
  readerToken,
  reader.id,
  user.id,
  team.id,
  channelId,
  dm.id,
  closed.id,
);
console.log(
  `Mattermost ${version} verified personal sidebar categories, order, flags, preferences and ownership.`,
);
const disposable = await (
  await create(
    "posts",
    { channel_id: channelId, message: "Offline root" },
    readerToken,
  )
).json();
const child = await (
  await create(
    "posts",
    { channel_id: channelId, root_id: disposable.id, message: "Offline reply" },
    readerToken,
  )
).json();
const previousPage = await readerPosts.getPostsForChannel(page);
assert.equal(
  (
    await fetch(`${base}/api/v4/posts/${disposable.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${readerToken}` },
    })
  ).status,
  200,
);
const sinceDeletion = { ...page, since: disposable.create_at - 1 };
const changed = channelHistoryPage(
  sinceDeletion,
  await readerPosts.getPostsForChannel(sinceDeletion),
);
const delta = changed.changes;
const fresh = channelPostChanges(
  channelId,
  await readerPosts.getPostsForChannel(page),
);
const earlier = channelPostChanges(channelId, previousPage);
for (const post of [disposable, child]) {
  assert.ok(changed.order.includes(post.id));
  assert.deepEqual(
    delta.find((change) => change.id === post.id),
    { kind: "remove", id: post.id, channelId },
  );
  assert.ok(fresh.every((change) => change.id !== post.id));
  assert.ok(
    earlier.some(
      (change) =>
        change.id === post.id &&
        change.kind === "save" &&
        change.message === post.message,
    ),
  );
}
console.log(
  `Mattermost ${version} verified ordinary-member root and reply removal in channel records.`,
);

const newest = await message("New post for a sparse change page");
const edit = await fetch(`${base}/api/v4/posts/${root.id}/patch`, {
  method: "PUT",
  headers: { ...authorization, "Content-Type": "application/json" },
  body: JSON.stringify({ id: root.id, message: "Edited earlier root" }),
});
assert.equal(edit.status, 200);
const sinceEdit = { channelId, since: newest.create_at - 1 };
const sparse = channelHistoryPage(
  sinceEdit,
  await posts.getPostsForChannel(sinceEdit),
);
assert.deepEqual(sparse.source, { kind: "since", since: sinceEdit.since });
assert.ok(sparse.order.includes(root.id) && sparse.order.includes(newest.id));
assert.ok(!sparse.order.includes(reply.id));
console.log(
  `Mattermost ${version} verified page origin, visible neighbors and a sparse history update.`,
);

// A failed local save must revoke only the new server session for this same user.
await verifyHistoryRefresh(
  readerPosts,
  channelId,
  root.id,
  reply.id,
  sinceEdit.since,
  sinceDeletion.since,
  [disposable.id, child.id],
);
console.log(
  `Mattermost ${version} verified the generated requests and normalized writes for all five channel history refresh operations.`,
);

// A bot may create a direct channel with its owner, so create it after the empty-directory fixture.
const bot = await (
  await create(
    "bots",
    { username: "profile-fixture-bot", display_name: "Fixture Bot" },
    token,
  )
).json();
assert.equal(typeof bot.user_id, "string");
const users = new UsersApi(session);
const profiles = await users.getUsersByIds({
  requestBody: [user.id, bot.user_id],
});
const person = profiles.find((profile) => profile.id === user.id);
const botProfile = profiles.find((profile) => profile.id === bot.user_id);
assert.ok(person && botProfile);
assert.equal(person.position, "Fixture engineer");
assert.equal(person.isBot, undefined);
assert.equal(person.remoteId, "");
assert.equal(botProfile.isBot, true);
const readerProfile = await users.getUser({ userId: reader.id });
const personLabel = channelProfile(person);
const botLabel = channelProfile(botProfile);
const readerLabel = channelProfile(readerProfile);
assert.equal(personLabel.position, "Fixture engineer");
assert.equal(personLabel.remoteUsername, "");
assert.equal(botLabel.isBot, true);
const visibleById = await loadVisibleProfiles(session, {
  ids: [user.id, reader.id, bot.user_id],
  usernames: [],
});
const visibleByName = await loadVisibleProfiles(session, {
  ids: [],
  usernames: [
    readerLabel.username,
    botLabel.username,
    username,
    "unknown-lookup-fixture",
  ],
});
const known = indexChannelProfiles(visibleById);
assert.deepEqual(known.byId, indexChannelProfiles(visibleByName).byId);
assert.deepEqual(
  known.byId,
  indexChannelProfiles([personLabel, botLabel, readerLabel]).byId,
);
assert.equal(
  conversationName(
    { kind: dm.type, name: dm.name, displayName: dm.display_name },
    user.id,
    known,
    "username",
    "en",
  ),
  readerLogin.login_id,
);
const group = await (
  await create("channels/group", [user.id, reader.id, bot.user_id], token)
).json();
assert.equal(group.type, "G");
const groupName = {
  kind: group.type,
  name: group.name,
  displayName: group.display_name,
};
assert.deepEqual(
  new Set(group.display_name.split(", ")),
  new Set([username, readerLabel.username, botLabel.username]),
);
assert.equal(
  conversationName(groupName, user.id, known, "username", "en"),
  [readerLabel.username, botLabel.username].sort().join(", "),
);
assert.equal(
  conversationName(
    groupName,
    user.id,
    indexChannelProfiles([personLabel]),
    "username",
    "en",
  ),
  group.display_name,
);
console.log(
  `Mattermost ${version} verified local user position and bot identity through generated profile reads.`,
);
await checkProfileReads(
  base,
  users,
  { id: user.id, username },
  { id: bot.user_id, username: bot.username },
  version,
);

await checkPostMutations(base, posts, channelId, user.id, version);
await checkCommands(session, team.id, channelId, version);
// A self-join avoids the membership notification produced when somebody adds the reader.
const mentionRoom = await (
  await create(
    "channels",
    {
      team_id: team.id,
      name: "mention-text",
      display_name: "Mention text",
      type: "O",
    },
    token,
  )
).json();
await create(
  `channels/${mentionRoom.id}/members`,
  { user_id: reader.id },
  readerToken,
);
await checkMentionText(
  posts,
  closedReader,
  mentionRoom.id,
  readerLogin.login_id,
);
console.log(
  `Mattermost ${version} verified channel mentions against a second member’s counters.`,
);
const receiptRoom = await (
  await create(
    "channels",
    {
      team_id: team.id,
      name: "delivery-attempt",
      display_name: "Delivery attempt",
      type: "P",
    },
    token,
  )
).json();
await create(
  `channels/${receiptRoom.id}/members`,
  { user_id: reader.id },
  token,
);
await checkPreviouslyAcceptedPost(
  readerPosts,
  posts,
  receiptRoom.id,
  reader.id,
  () =>
    fetch(`${base}/api/v4/channels/${receiptRoom.id}/members/${reader.id}`, {
      method: "DELETE",
      headers: authorization,
    }),
  version,
);

await checkMentionLimit(
  base,
  token,
  closedReader,
  posts,
  channelId,
  readerLogin.login_id,
);
console.log(
  `Mattermost ${version} verified the channel notification limit against real member counts.`,
);

await checkPostReactions(base, token, session, user.id, reader.id, channelId);
console.log(
  `Mattermost ${version} verified empty and populated reaction lists and post metadata.`,
);

await checkEventStream(base, token, session, team.id, channelId);
console.log(
  `Mattermost ${version} verified sequenced posts, command replies and replay of a post after reconnect.`,
);

const secondLogin = await create("users/login", {
  login_id: username,
  password,
});
assert.equal(secondLogin.status, 200);
assert.equal((await secondLogin.json()).id, user.id);
const secondToken = secondLogin.headers.get("token");
assert.ok(secondToken && secondToken !== token, "Expected a distinct session");
const secondAuthorization = { Authorization: `Bearer ${secondToken}` };
const secondLogout = await fetch(`${base}/api/v4/users/logout`, {
  method: "POST",
  headers: secondAuthorization,
});
assert.equal(secondLogout.status, 200);
assert.equal((await secondLogout.json()).status, "OK");
assert.equal(
  (await fetch(`${base}/api/v4/users/me`, { headers: secondAuthorization }))
    .status,
  401,
);
const previous = await fetch(`${base}/api/v4/users/me`, {
  headers: authorization,
});
assert.equal(previous.status, 200);
assert.equal((await previous.json()).id, user.id);
await allowFixtureBrowserSignIn(base, token);
const logout = await fetch(`${base}/api/v4/users/logout`, {
  method: "POST",
  headers: authorization,
});
assert.equal(logout.status, 200);
assert.equal((await logout.json()).status, "OK");
assert.equal(
  (await fetch(`${base}/api/v4/users/me`, { headers: authorization })).status,
  401,
);
console.log(
  `Mattermost ${version} verified native Login and Logout, including independent sessions for the same account.`,
);
console.log(
  `Mattermost ${version} verified plain and collapsed history, thread participants, image dimensions and anonymous HTTP 401.`,
);

await checkBrowserSignIn(base, version, {
  username,
  password,
  email: user.email,
  id: user.id,
});
