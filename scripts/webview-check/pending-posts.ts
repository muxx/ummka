import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
const channel = { channelId: "w".repeat(26) };
const thread = { ...channel, rootId: "r".repeat(26) };
const firstText = "  Markdown **не теряется** 🐻‍❄️\n";
const secondText = "Second intentional message";
const threadText = "Reply in another editor";

async function save(
  account: Account,
  location: typeof channel,
  message: string,
) {
  const draft = await account.readDraft(location);
  const result = await account.saveDraft({
    ...location,
    expectedRevision: draft.revision,
    message,
  });
  if (result.kind !== "saved" || !result.draft.revision)
    throw Error("Could not prepare the saved draft");
  return result.draft.revision;
}

export async function stagePendingPosts(
  account: Account,
  neighbor: Account,
  userId: string,
) {
  const revision = await save(account, channel, firstText);
  const attempts = await Promise.all(
    [account, neighbor].map((connection) =>
      connection.stagePost({ ...channel, revision }),
    ),
  );
  const created = attempts.find((result) => result.kind === "created");
  const stale = attempts.find((result) => result.kind === "notStaged");
  if (
    !created ||
    !stale ||
    !created.draft.revision ||
    stale.draft.revision !== created.draft.revision ||
    stale.draft.message !== "" ||
    created.post.message !== firstText ||
    created.post.previousLogin ||
    created.post.confirmedPostId !== null ||
    !created.post.pendingId.startsWith(`${userId}:`)
  )
    throw Error("Two windows must stage one draft exactly once");
  for (const [location, message] of [
    [channel, secondText],
    [thread, threadText],
  ] as const) {
    const next = await account.stagePost({
      ...location,
      revision: await save(account, location, message),
    });
    if (
      next.kind !== "created" ||
      next.post.pendingId === created.post.pendingId
    )
      throw Error("A second draft must create its own attempt");
  }
  await checkPendingRestore(neighbor, true);
}

export async function checkPendingRestore(account: Account, saved: boolean) {
  const page = { after: 0, limit: 1 };
  const [first, replies] = await Promise.all([
    account.readPendingPosts({ ...channel, ...page }),
    account.readPendingPosts({ ...thread, ...page }),
  ]);
  if (!saved) {
    if (first.length || replies.length)
      throw Error("Another installation exposed pending messages");
    return;
  }
  const post = first[0];
  if (
    first.length !== 1 ||
    !post ||
    post.channelId !== channel.channelId ||
    post.rootId !== null ||
    post.message !== firstText ||
    post.previousLogin ||
    post.confirmedPostId !== null ||
    !Number.isSafeInteger(post.sequence) ||
    post.createdAt <= 0 ||
    replies.length !== 1 ||
    replies[0]?.rootId !== thread.rootId ||
    replies[0]?.message !== threadText
  )
    throw Error(
      "Saved pending posts did not keep their channel, thread or text",
    );
  const next = await account.readPendingPosts({
    ...channel,
    after: post.sequence,
    limit: 5,
  });
  if (
    next.length !== 1 ||
    next[0]?.message !== secondText ||
    next[0].sequence <= post.sequence
  )
    throw Error("Pending messages did not resume at the exclusive cursor");
}
