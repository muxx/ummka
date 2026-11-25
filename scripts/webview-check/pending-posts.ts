import { invoke } from "@tauri-apps/api/core";
import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";
import { expectCode } from "./local-history.ts";

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
    created.draft.clearedBySubmission !== true ||
    stale.draft.clearedBySubmission !== true ||
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
  const repeated = await neighbor.saveDraft({
    ...channel,
    expectedRevision: revision,
    message: "",
  });
  if (repeated.kind !== "saved" || repeated.draft.clearedBySubmission !== true)
    throw Error("Re-saving an empty editor lost the cause of submission");
  const typed = await save(account, thread, "another reply");
  const erased = await neighbor.saveDraft({
    ...thread,
    expectedRevision: typed,
    message: "",
  });
  if (erased.kind !== "saved" || erased.draft.clearedBySubmission !== false)
    throw Error(
      "Manual clearing did not replace the previous submission cause",
    );
  const staleEdit = await account.saveDraft({
    ...thread,
    expectedRevision: typed,
    message: "late reply",
  });
  if (
    staleEdit.kind !== "conflict" ||
    staleEdit.draft.clearedBySubmission !== false
  )
    throw Error("Conflicting editor lost the cause of clearing");
  await checkPendingRestore(neighbor, true);
  await expectCode(
    invoke("read_pending_posts", {
      rid: account.rid,
      ...channel,
      rootId: null,
      after: 0,
      before: 5,
      limit: 2,
    }),
    "invalid_history_request",
  );
}

export async function checkPendingRestore(account: Account, saved: boolean) {
  const page = { after: 0, limit: 1 };
  const [first, replies, roomDraft, threadDraft, newest] = await Promise.all([
    account.readPendingPosts({ ...channel, ...page }),
    account.readPendingPosts({ ...thread, ...page }),
    account.readDraft(channel),
    account.readDraft(thread),
    account.readPendingPosts({ ...channel, limit: 1 }),
  ]);
  if (
    roomDraft.message !== "" ||
    threadDraft.message !== "" ||
    roomDraft.clearedBySubmission !== (saved ? true : undefined) ||
    threadDraft.clearedBySubmission !== (saved ? false : undefined)
  )
    throw Error("Restored drafts lost their account or clearing cause");
  if (!saved) {
    if (first.length || replies.length || newest.length)
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
    BigInt(next[0].sequence) <= BigInt(post.sequence)
  )
    throw Error("Pending messages did not resume at the exclusive cursor");
  if (newest.length !== 1 || newest[0].pendingId !== next[0].pendingId)
    throw Error(
      "Opening the conversation did not return its latest outgoing message",
    );
  const earlier = await account.readPendingPosts({
    ...channel,
    before: newest[0].sequence,
    limit: 2,
  });
  if (earlier.length !== 1 || earlier[0].pendingId !== post.pendingId)
    throw Error(
      "Reading backwards crossed the channel, thread or cursor boundary",
    );
  const belowMaximum = await account.readPendingPosts({
    ...channel,
    before: "9223372036854775807",
    limit: 1,
  });
  if (belowMaximum[0]?.pendingId !== newest[0].pendingId)
    throw Error(
      "An exact 64-bit boundary was lost between the WebView and SQLite",
    );
  await expectCode(
    account.readPendingPosts({
      ...channel,
      after: "9223372036854775808",
      limit: 1,
    }),
    "invalid_history_request",
  );
  await expectCode(
    account.readPendingPosts({
      ...channel,
      before: Number.MAX_SAFE_INTEGER + 1,
      limit: 1,
    }),
    "invalid_history_request",
  );
}
