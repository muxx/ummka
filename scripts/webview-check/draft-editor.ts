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
    room.getSnapshot().message !== (saved ? "  This channel 🐻‍❄️\n" : "") ||
    reply.getSnapshot().message !== (saved ? "In the thread" : "")
  )
    throw Error(
      "The editor restored a draft from another account or conversation",
    );
}
