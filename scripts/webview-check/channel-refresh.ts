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
    thread.replies[0]?.id !== reply ||
    thread.next !== null
  )
    throw Error("Account did not read the requested thread page.");
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
  if (
    (
      await account.refreshChannelHistory({
        ...scoped,
        kind: "focused",
        postId: root,
        perPage: 1,
      })
    ).kind !== "applied"
  )
    throw Error("focused refresh did not commit");
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
