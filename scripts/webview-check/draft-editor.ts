import { openDraftEditor } from "../../src/channels/draft-editor.ts";
import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
const channel = { channelId: "drafteditor".padEnd(26, "c") };
const thread = { ...channel, rootId: "drafteditor".padEnd(26, "t") };

export async function checkDraftEditors(account: Account, neighbor: Account) {
  const [first, second, reply] = await Promise.all([
    openDraftEditor(account, channel),
    openDraftEditor(neighbor, channel),
    openDraftEditor(neighbor, thread),
  ]);
  first.edit("  This channel 🐻‍❄️\n");
  reply.edit("In the thread");
  await Promise.all([first.flush(), reply.flush()]);
  second.edit("Another window");
  await second.flush();
  const state = second.getSnapshot();
  if (
    !state.conflict ||
    state.message !== "Another window" ||
    state.stored.message !== first.getSnapshot().message ||
    reply.getSnapshot().message !== "In the thread"
  )
    throw Error(
      "The local editor lost either a conflict or its independent reply",
    );
  first.edit("Changed again before the choice");
  await first.flush();
  await second.keepLocal(state.stored.revision);
  const updated = second.getSnapshot();
  if (
    !updated.conflict ||
    updated.stored.message !== first.getSnapshot().message
  )
    throw Error("An old conflict choice replaced an unseen device revision");
  second.takeStored(updated.stored.revision);
  if (second.getSnapshot().message !== updated.stored.message)
    throw Error("The editor did not adopt the displayed device text");
  second.edit("Kept in this window");
  first.edit("Other edit");
  await first.flush();
  await second.refresh();
  const choice = second.getSnapshot();
  if (!choice.conflict || choice.stored.message !== "Other edit")
    throw Error("Refreshing a dirty editor lost the competing edit");
  await second.keepLocal(choice.stored.revision);
  await first.refresh();
  if (
    first.getSnapshot().message !== "Kept in this window" ||
    second.getSnapshot().conflict
  )
    throw Error("A clean neighbor did not adopt the resolved draft");
}

export async function checkDraftEditorsRestored(
  account: Account,
  saved: boolean,
) {
  const [room, reply] = await Promise.all([
    openDraftEditor(account, channel),
    openDraftEditor(account, thread),
  ]);
  if (
    room.getSnapshot().message !== (saved ? "Kept in this window" : "") ||
    reply.getSnapshot().message !== (saved ? "In the thread" : "")
  )
    throw Error(
      "The editor restored a draft from another account or conversation",
    );
}
