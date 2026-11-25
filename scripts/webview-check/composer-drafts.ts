import { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";
import { checkAttemptActions, checkAttemptRestore } from "./attempt-actions.ts";
import { checkReceipts, checkReceiptsRestore } from "./delivery-receipts.ts";
import {
  checkDraftEditors,
  checkDraftEditorsRestored,
} from "./draft-editor.ts";
import { checkPendingRestore, stagePendingPosts } from "./pending-posts.ts";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
const channel = { channelId: "c".repeat(26) };
const reply = { ...channel, rootId: "r".repeat(26) };
const channelText = "  Черновик канала\n🐻‍❄️ ";
const threadText = "Другой текст в треде";

export async function checkDraftWrites(
  account: Account,
  other: Account,
  userId: string,
) {
  const neighbor = await openAccountRestConnection(account.basePath, userId);
  try {
    await checkDraftEditors(account, neighbor);
    const original = await neighbor.readDraft(channel);
    if (original.message !== "" || original.revision !== null)
      throw Error("new editor already has a draft");
    const first = await account.saveDraft({
      ...channel,
      expectedRevision: null,
      message: channelText,
    });
    const second = await account.saveDraft({
      ...reply,
      expectedRevision: null,
      message: threadText,
    });
    if (
      first.kind !== "saved" ||
      !first.draft.revision ||
      second.kind !== "saved" ||
      !second.draft.revision
    )
      throw Error("channel and thread drafts were not saved");
    const stale = await neighbor.saveDraft({
      ...channel,
      expectedRevision: original.revision,
      message: "delayed input",
    });
    if (
      stale.kind !== "conflict" ||
      stale.draft.message !== channelText ||
      stale.draft.revision !== first.draft.revision
    )
      throw Error("stale window overwrote a draft");
    const repeated = await neighbor.saveDraft({
      ...channel,
      expectedRevision: null,
      message: channelText,
    });
    if (
      repeated.kind !== "saved" ||
      repeated.draft.revision !== first.draft.revision
    )
      throw Error("retry changed the draft revision");
    const outgoing = await account.saveDraft({
      ...channel,
      expectedRevision: first.draft.revision,
      message: "Исходящее после перезапуска",
    });
    if (outgoing.kind !== "saved" || !outgoing.draft.revision)
      throw Error("Could not prepare offline outgoing text");
    const staged = await account.stagePost({
      ...channel,
      revision: outgoing.draft.revision,
    });
    if (staged.kind !== "created")
      throw Error("Could not stage the offline timeline fixture");
    const restored = await account.saveDraft({
      ...channel,
      expectedRevision: staged.draft.revision,
      message: channelText,
    });
    if (restored.kind !== "saved")
      throw Error("Could not restore the independent live draft");
    await stagePendingPosts(account, neighbor, userId);
    await checkReceipts(account, other, userId);
    await checkAttemptActions(account, neighbor, other);
    await checkDraftRestore(other, false);
  } finally {
    await neighbor.close();
  }
}

export async function checkDraftRestore(account: Account, saved: boolean) {
  await checkAttemptRestore(account, saved);
  await checkPendingRestore(account, saved);
  await checkReceiptsRestore(account, saved);
  await checkDraftEditorsRestored(account, saved);
  const [room, thread] = await Promise.all([
    account.readDraft(channel),
    account.readDraft(reply),
  ]);
  if (
    room.message !== (saved ? channelText : "") ||
    thread.message !== (saved ? threadText : "") ||
    (room.revision !== null) !== saved ||
    (thread.revision !== null) !== saved
  )
    throw Error("wrong channel or thread draft for this installation");
}
