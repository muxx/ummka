import { openDraftEditor } from "../../src/channels/draft-editor.ts";
import { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
const channelId = "submitroom".padEnd(26, "0");
const rootId = "submissionroot".padEnd(26, "0");

async function edit(account: Account, message: string, root?: string) {
  const location = { channelId, rootId: root };
  const previous = await account.readDraft(location);
  const saved = await account.saveDraft({
    ...location,
    expectedRevision: previous.revision,
    message,
  });
  if (saved.kind !== "saved" || !saved.draft.revision)
    throw Error("Submission fixture draft could not be saved");
  return { ...location, revision: saved.draft.revision };
}
async function start(account: Account, message: string, root?: string) {
  const editor = await openDraftEditor(account, { channelId, rootId: root });
  editor.edit(message);
  const started = await editor.submit();
  if (started.kind !== "sending")
    throw Error("A fresh saved draft should start one request");
  if (
    editor.getSnapshot().message !== "" ||
    editor.getSnapshot().stored.clearedBySubmission !== true
  )
    throw Error("The editor did not accept its local submission");
  return started;
}

export async function checkSubmissions(
  prefixed: Account,
  other: Account,
  userId: string,
  control: (step: string, name: string) => Promise<void>,
) {
  const neighbor = await openAccountRestConnection(prefixed.basePath, userId);
  try {
    await edit(prefixed, "  **First** 🐻‍❄️\n");
    const editors = await Promise.all(
      [prefixed, neighbor].map((account) =>
        openDraftEditor(account, { channelId }),
      ),
    );
    const results = await Promise.all(editors.map((editor) => editor.submit()));
    const started = results.find((r) => r.kind === "sending");
    if (
      !started ||
      !results.some((r) => r.kind === "notStaged") ||
      started.draft.message !== "" ||
      editors.some((editor) => editor.getSnapshot().message !== "")
    )
      throw Error("Exactly one window should send before the HTTP result");
    await control("received", "submit-post");
    const owner = results[0].kind === "sending" ? prefixed : neighbor;
    const passive = owner === prefixed ? neighbor : prefixed;
    if (
      !owner.isPostSending(started.post) ||
      passive.isPostSending(started.post)
    )
      throw Error(
        "Only the connection that started HTTP knows its live attempt",
      );
    const sending = owner.getOutgoingPostState(started.post);
    const unconfirmed = passive.getOutgoingPostState(started.post);
    if (sending.kind !== "sending" || unconfirmed.kind !== "unconfirmed")
      throw Error(
        "The same saved row must reflect the request observed by its own connection",
      );
    const updates: boolean[] = [];
    const stop = owner.subscribeToPostActivity({ channelId }, () => {
      updates.push(owner.isPostSending(started.post));
    });
    const duplicate = await owner.resendPost(started.post, {
      kind: "despiteUnknownDelivery",
    });
    if (duplicate.kind !== "unavailable")
      throw Error("An active submission should not reserve a second attempt");
    const waiting = await neighbor.readPendingPosts({
      channelId,
      after: 0,
      limit: 10,
    });
    if (
      waiting.length !== 1 ||
      waiting[0]?.confirmedPostId !== null ||
      waiting[0].pendingId !== started.post.pendingId
    )
      throw Error("The message must be durable while HTTP is still held");
    editors[0].edit("The next draft while the server is replying");
    await editors[0].flush();
    await editors[1].refresh();
    if (
      editors[1].getSnapshot().message !==
      "The next draft while the server is replying"
    )
      throw Error("The network response blocked the next local draft");
    await control("release-submission", "submit-post");
    const accepted = await started.completion;
    stop();
    if (updates.length !== 1 || updates[0] !== false)
      throw Error(
        "A newly mounted conversation did not observe the end of its request",
      );
    if (
      accepted.kind !== "accepted" ||
      !accepted.matched ||
      accepted.post.id !== rootId
    )
      throw Error("The server response did not confirm the submitted root");
    const denied = await start(prefixed, "Declined reply", rootId);
    const refusal = await denied.completion;
    if (
      refusal.kind !== "refused" ||
      refusal.refusal.status !== 403 ||
      refusal.refusal.message !== "Fixture channel is read only"
    )
      throw Error("A definitive refusal must reach the saved reply");
    const [savedReply] = await neighbor.readPendingPosts({
      channelId,
      rootId,
      after: 0,
      limit: 1,
    });
    const declined = neighbor.getOutgoingPostState(savedReply);
    if (
      declined.kind !== "refused" ||
      declined.refusal.status !== 403 ||
      !declined.actions.edit
    )
      throw Error(
        "A definitive refusal should offer editing in the other window",
      );
    const corrected = await neighbor.resendPost(denied.post, {
      kind: "afterRefusal",
      message: "Corrected reply",
    });
    if (
      corrected.kind !== "sending" ||
      corrected.post.pendingId !== denied.post.pendingId ||
      (await corrected.completion).kind !== "accepted"
    )
      throw Error("Explicit correction must reuse the original ID");
    const stale = await prefixed.resendPost(denied.post, {
      kind: "afterRefusal",
      message: "should never reach server",
    });
    if (stale.kind !== "unavailable")
      throw Error("A stale retry issued a second request");
    const unknown = await start(prefixed, "Response lost");
    if ((await unknown.completion).kind !== "unconfirmed")
      throw Error("A 503 cannot prove refusal");
    const again = await neighbor.resendPost(unknown.post, {
      kind: "despiteUnknownDelivery",
    });
    if (again.kind !== "sending")
      throw Error("The permitted retry was not sent");
    const retried = await again.completion;
    if (retried.kind !== "unconfirmed" || retried.retryRefusal?.status !== 403)
      throw Error(
        "The second refusal cannot disprove the missing response to the first request",
      );
    const wrong = await start(prefixed, "Wrong author");
    if ((await wrong.completion).kind !== "unconfirmed")
      throw Error("Another author's post cannot confirm a submission");
    const expired = await start(other, "Sign-in expired");
    if ((await expired.completion).kind !== "unauthorized")
      throw Error("HTTP 401 must reach the session owner");
    await checkSubmissionRestore(prefixed, true);
    await checkSubmissionRestore(other, false);
  } finally {
    await neighbor.close();
  }
}

export async function checkSubmissionRestore(
  account: Account,
  prefixed: boolean,
) {
  const [roots, replies] = await Promise.all([
    account.readPendingPosts({ channelId, after: 0, limit: 10 }),
    account.readPendingPosts({ channelId, rootId, after: 0, limit: 10 }),
  ]);
  if (roots.some(account.isPostSending) || replies.some(account.isPostSending))
    throw Error(
      "Restored submission rows must not restart HTTP or report an active request",
    );
  if (
    prefixed
      ? roots.length !== 3 ||
        roots[0]?.confirmedPostId !== rootId ||
        roots[1]?.attempt !== 2 ||
        roots[1].refusal !== null ||
        roots[1].retryRefusal?.code !== "api.context.permissions.app_error" ||
        roots[1].retryRefusal.message !== "Fixture channel is read only" ||
        roots[2]?.confirmedPostId !== null ||
        replies.length !== 1 ||
        replies[0]?.attempt !== 2 ||
        replies[0]?.rootId !== rootId ||
        replies[0]?.message !== "Corrected reply"
      : roots.length !== 1 ||
        roots[0]?.message !== "Sign-in expired" ||
        roots[0].refusal !== null ||
        replies.length
  )
    throw Error(
      "Passive recovery must keep exactly this installation's submission results",
    );
  if (prefixed) {
    const confirmed = account.getOutgoingPostState(roots[0]);
    const uncertain = account.getOutgoingPostState(roots[1]);
    if (
      confirmed.kind !== "delivered" ||
      confirmed.postId !== rootId ||
      uncertain.kind !== "unconfirmed" ||
      uncertain.retryRefusal?.status !== 403 ||
      !uncertain.actions.copy ||
      uncertain.actions.edit !== undefined
    )
      throw Error(
        "Recovered delivery and retry refusal should retain distinct actions",
      );
  }
}
