import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
const channel = { channelId: "v".repeat(26) };
const thread = { ...channel, rootId: "q".repeat(26) };
const command = "/me checks the local draft";

export async function checkDraftCommand(account: Account, neighbor: Account) {
  const original = await account.saveDraft({
    ...channel,
    expectedRevision: null,
    message: command,
  });
  if (original.kind !== "saved" || !original.draft.revision)
    throw Error("command-draft-missing");
  const location = { ...channel, revision: original.draft.revision };
  const attempts = await Promise.all(
    [account, neighbor].map((connection) =>
      connection.transitionDraftCommand(location, "start"),
    ),
  );
  const started = attempts.find((a) => a.kind === "saved")?.draft;
  const conflict = attempts.find((a) => a.kind === "conflict")?.draft;
  if (
    !started?.revision ||
    !started.commandPending ||
    !conflict?.commandPending ||
    started.revision !== conflict.revision
  )
    throw Error("command-started-twice");
  const attempt = { ...channel, revision: started.revision };
  if ((await neighbor.stagePost(attempt)).kind !== "notStaged")
    throw Error("command-posted-as-text");

  const reply = await neighbor.saveDraft({
    ...thread,
    expectedRevision: null,
    message: command,
  });
  if (!reply.draft.revision) throw Error("command-thread-missing");
  const first = await neighbor.transitionDraftCommand(
    { ...thread, revision: reply.draft.revision },
    "start",
  );
  if (first.kind !== "saved" || !first.draft.revision)
    throw Error("command-thread-start");
  const refused = await account.transitionDraftCommand(
    { ...thread, revision: first.draft.revision },
    "release",
  );
  if (
    refused.kind !== "saved" ||
    !refused.draft.revision ||
    refused.draft.commandPending ||
    refused.draft.message !== command
  )
    throw Error("command-thread-refusal");
  const next = await account.transitionDraftCommand(
    { ...thread, revision: refused.draft.revision },
    "start",
  );
  if (next.kind !== "saved" || !next.draft.revision)
    throw Error("command-explicit-retry");
  if (
    (
      await neighbor.transitionDraftCommand(
        { ...thread, revision: first.draft.revision },
        "complete",
      )
    ).kind !== "conflict"
  )
    throw Error("command-stale-completion");
  const sent = await account.transitionDraftCommand(
    { ...thread, revision: next.draft.revision },
    "complete",
  );
  if (
    sent.kind !== "saved" ||
    sent.draft.message !== "" ||
    !sent.draft.clearedBySubmission
  )
    throw Error("command-thread-completion");
}

export async function checkCommandRestored(account: Account, saved: boolean) {
  const draft = await account.readDraft(channel);
  if (!saved) {
    if (draft.revision !== null || draft.commandPending)
      throw Error("command-crossed-account");
    return;
  }
  if (!draft.commandPending || !draft.revision || draft.message !== command)
    throw Error("command-lost-after-restart");
  const location = { ...channel, revision: draft.revision };
  if (
    (await account.transitionDraftCommand(location, "start")).kind !==
      "conflict" ||
    (await account.stagePost(location)).kind !== "notStaged"
  )
    throw Error("restored-command-submitted");
  if ((await account.readPendingPosts({ ...channel, limit: 10 })).length !== 0)
    throw Error("command-entered-outgoing");
}
