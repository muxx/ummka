import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;

export async function checkPostReactions(root: Account, prefixed: Account) {
  const postId = "p".repeat(26);
  if ((await root.readPostReactions(postId)).length !== 0)
    throw Error("empty signed post reaction list");
  const rows = await prefixed.readPostReactions(postId);
  const [row] = rows;
  if (
    rows.length !== 1 ||
    row?.postId !== postId ||
    row.emojiName !== "+1" ||
    row.updateAt !== 34 ||
    row.deleteAt !== 0 ||
    row.remoteId !== null ||
    row.channelId !== "c".repeat(26)
  )
    throw Error("signed reaction with nullable remote id");
  const own = await prefixed.addOwnReaction(postId, "+1");
  if (own.emojiName !== "+1" || own.createAt !== 42)
    throw Error("signed reaction creation");
  await prefixed.removeOwnReaction(postId, "+1");
}
