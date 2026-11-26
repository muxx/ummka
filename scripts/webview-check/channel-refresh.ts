import { prepareFocusedConversation } from "../../src/channels/prepare-focused-conversation.ts";
import { channelPostChange } from "../../src/mattermost/channel-post-records.ts";
import { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";
import { ResponseError } from "../../vendor/mattermost/index.js";

const channelId = "w".repeat(26),
  root = "k".repeat(26),
  reply = "l".repeat(26);
type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;

export async function checkChannelRefresh(
  account: Account,
  observe: (step: string, name: string) => Promise<void>,
) {
  const thread = await account.readThreadPage({
    channelId,
    rootId: root,
    direction: "up",
    collapsedThreads: true,
    perPage: 1,
    cursor: { id: "x".repeat(26), createAt: 400 },
  });
  if (
    thread.kind !== "page" ||
    thread.root.id !== root ||
    thread.root.isFollowing !== false ||
    thread.replies[0]?.id !== reply ||
    thread.next !== null
  )
    throw Error("Account did not read the requested thread page.");
  const flatThread = await account.readThreadPage({
    channelId,
    rootId: root,
    direction: "down",
    collapsedThreads: false,
    perPage: 1,
  });
  if (flatThread.kind !== "page" || flatThread.root.isFollowing !== undefined)
    throw Error("Flat thread unexpectedly reported the user's subscription.");
  const target = channelPostChange(channelId, root, thread.root);
  if (target.kind !== "save") throw Error("Expected a visible fixture root.");
  const { signal } = new AbortController();
  const focused = await prepareFocusedConversation(
    account,
    target,
    false,
    signal,
  );
  if (
    focused.status !== "ready" ||
    focused.anchorId !== root ||
    focused.page.posts.map((post) => post.id).join(",") !==
      [reply, root, "m".repeat(26)].join(",")
  )
    throw Error("Focused refresh did not publish the ordered SQLite window.");
  const scoped = { channelId, collapsedThreads: false };
  for (const collapsedThreads of [false, true]) {
    const result = await account.refreshChannelHistory({
      ...scoped,
      kind: "latest",
      collapsedThreads,
    });
    if (result.kind !== "applied")
      throw Error("channel refresh did not commit");
  }
  const savedReply = await account.readSavedPost(channelId, reply);
  if (!savedReply) throw Error("Missing saved reply for focused navigation");
  for (const collapsed of [true, false]) {
    const result = await prepareFocusedConversation(
      account,
      savedReply,
      collapsed,
      signal,
    );
    const anchor = collapsed ? root : reply;
    if (
      result.status !== "ready" ||
      result.anchorId !== anchor ||
      !result.page.posts.some((row) => row.id === anchor) ||
      result.focusedReply?.id !== (collapsed ? reply : undefined)
    )
      throw Error(
        "Stored reply did not resolve to its exact channel or thread position.",
      );
  }
  const error = await account
    .refreshChannelHistory({ ...scoped, kind: "since", since: 3 })
    .catch((e: unknown) => e);
  if (!(error instanceof ResponseError) || error.response.status !== 503)
    throw Error("failed refresh lost its server error");
  const before = await account.readChannelWindow({
    ...scoped,
    kind: "latest",
    limit: 10,
  });
  if (before?.posts.length !== 3)
    throw Error("failed refresh changed the existing timeline");
  const pending = account.refreshChannelHistory({
    ...scoped,
    kind: "before",
    postId: "x".repeat(26),
  });
  await Promise.race([
    observe("received", "refresh-late"),
    pending.then(() => {
      throw Error("late page finished before the server released it");
    }),
  ]);
  try {
    const deletion = await account.refreshChannelHistory({
      ...scoped,
      kind: "since",
      since: 2,
    });
    if (deletion.kind !== "applied")
      throw Error("concurrent removal not committed");
  } finally {
    await observe("release-history", "refresh-late");
  }
  if ((await pending).kind !== "superseded")
    throw Error("delayed HTTP response restored the removed post");
}

export async function checkRefreshedAfterRestart(origin: string) {
  const connection = await openAccountRestConnection(
    `${origin}/team/chat`,
    "Abc01234567890123456789012",
  );
  try {
    if ((await connection.readSavedPost(channelId, "m".repeat(26))) !== null)
      throw Error("Deleted post remained available by ID after restart");
    for (const collapsedThreads of [false, true]) {
      const page = await connection.readChannelWindow({
        kind: "latest",
        channelId,
        collapsedThreads,
        limit: 60,
      });
      const expected = (collapsedThreads ? [root] : [reply, root]).join(",");
      if (
        page?.posts.map((p) => p.id).join(",") !== expected ||
        page.older.kind !== "end" ||
        page.newer.kind !== "end"
      )
        throw Error(
          "restored timeline does not match the successfully downloaded page and deletion",
        );
    }
  } finally {
    await connection.close();
  }
}
