import type { PendingPost } from "../../src/mattermost/account-delivery.ts";
import { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";
import { deliverAccountPost } from "../../src/mattermost/send-account-post.ts";
import { Configuration, PostsApi } from "../../vendor/mattermost/index.js";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
type Control = (step: string, name: string) => Promise<void>;
const channelId = "filesroom".padEnd(26, "0");
const rootId = "filesparent".padEnd(26, "0");

function check(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

// The boot fixture queued these uploads in the signed account database. Use
// its native reads and receipts without exposing a new renderer send command.
export async function checkFileSubmissions(
  account: Account,
  userId: string,
  control: Control,
) {
  const send = (connection: Account, pending: PendingPost) =>
    deliverAccountPost(
      new PostsApi(new Configuration(connection)),
      userId,
      pending,
      connection,
    );
  const roots = () =>
    account.readPendingPosts({ channelId, after: 0, limit: 4 });
  const [[reordered, first, refused, retiring], [reply]] = await Promise.all([
    roots(),
    account.readPendingPosts({ channelId, rootId, after: 0, limit: 1 }),
  ]);
  check(
    reordered && first && refused && retiring && reply,
    "missing durable file posts",
  );
  const deliveredRoot = await send(account, reordered);
  check(
    deliveredRoot.kind === "accepted" &&
      deliveredRoot.matched &&
      deliveredRoot.post.fileIds?.join(",") ===
        `${"f".repeat(26)},${"e".repeat(26)}`,
    "first signed response should retain the server order",
  );
  const uncertain = await send(account, first);
  check(uncertain.kind === "unconfirmed", "file post with an unknown result");
  const retry = await account.resendPost(first, {
    kind: "despiteUnknownDelivery",
  });
  check(
    retry.kind === "sending" &&
      retry.post.pendingId === first.pendingId &&
      retry.post.attempt === 2,
    "wrong retry for the durable file post",
  );
  await Promise.race([
    control("received", "submit-file-retry"),
    retry.completion.then(() => {
      throw Error("file retry ended before the fixture received it");
    }),
  ]);
  // An event may arrive before the REST response, while another channel has
  // already been opened. The receipt is still bound to the saved destination.
  await account.readDraft({ channelId: "c".repeat(26) });
  const canonical = "filecanonical".padEnd(26, "0");
  const event = {
    id: canonical,
    userId,
    channelId,
    rootId: "",
    pendingPostId: first.pendingId,
    deleteAt: 0,
    fileIds: ["a".repeat(26)],
  };
  check(
    !(await account.confirmPostDelivery(
      { kind: "posted" },
      { ...event, pendingPostId: "" },
    )),
    "posted event without a key must not confirm a file post",
  );
  check(
    await account.confirmPostDelivery({ kind: "posted" }, event),
    "posted event should confirm the file post before REST",
  );
  await control("release-submission", "submit-file-retry");
  const partial = await retry.completion;
  check(
    partial.kind === "accepted" &&
      partial.matched &&
      partial.post.id === canonical &&
      partial.post.pendingPostId === "" &&
      partial.post.fileIds?.length === 1 &&
      partial.post.fileIds[0] === "a".repeat(26),
    "partial response should keep the server attachment list",
  );
  const duplicate = await account.resendPost(retry.post, {
    kind: "despiteUnknownDelivery",
  });
  check(duplicate.kind === "unavailable", "confirmed file post was sent again");

  const deliveredReply = await send(account, reply);
  check(
    deliveredReply.kind === "accepted" &&
      deliveredReply.matched &&
      deliveredReply.post.message === "" &&
      deliveredReply.post.rootId === rootId,
    "file-only reply failed",
  );
  check(
    await account.confirmPostDelivery({ kind: "posted" }, deliveredReply.post),
    "posted event after REST should match the same file-only reply",
  );
  const denial = await send(account, refused);
  check(
    denial.kind === "refused" && denial.refusal.status === 403,
    "file post refusal",
  );

  const closing = await openAccountRestConnection(account.basePath, userId);
  const stopped = send(closing, retiring).then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    await Promise.race([
      control("received", "submit-file-retire"),
      stopped.then(() => {
        throw Error("file send ended before the fixture received it");
      }),
    ]);
  } finally {
    await closing.close();
  }
  const reason = await stopped;
  check(
    reason === "cancelled" || reason === "unknown_connection",
    "retiring the file send should close the signed request",
  );
  await control("closed", "submit-file-retire");
  const [confirmed, accepted, denied, closed] = await roots();
  check(
    confirmed?.confirmedPostId === "reorderedfiles".padEnd(26, "0") &&
      confirmed.files.map((file) => file.id).join(",") ===
        `${"e".repeat(26)},${"f".repeat(26)}` &&
      accepted?.confirmedPostId === canonical &&
      accepted.attempt === 2 &&
      accepted.files.length === 2 &&
      denied?.refusal?.status === 403 &&
      closed?.confirmedPostId === null &&
      closed.attempt === 1,
    "unexpected saved file post receipts",
  );
}
