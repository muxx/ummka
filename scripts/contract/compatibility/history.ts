import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  ChannelsApi,
  Configuration,
  PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

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
  await create("users", { username, password, email: "history@example.test" })
).json();
const login = await create("users/login", { login_id: username, password });
const token =
  login.headers.get("token") ?? assert.fail("Missing fixture session");
const team = await (
  await create(
    "teams",
    { name: "fixture", display_name: "Fixture", type: "O" },
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
assert.equal(ordinary.firstInaccessiblePostTime, 0);
const size = ordinary.posts?.[image.id]?.metadata?.images?.[imageUrl];
assert.deepEqual(size, { height: 3, width: 4, format: "png", frameCount: 0 });

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
await assert.rejects(
  anonymous.getPostsForChannel(page),
  (error) => error instanceof ResponseError && error.response.status === 401,
);
console.log(
  `Mattermost ${version} verified plain and collapsed history, thread participants, image dimensions and anonymous HTTP 401.`,
);
