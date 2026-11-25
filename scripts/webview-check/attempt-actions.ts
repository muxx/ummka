import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";
import { expectCode } from "./local-history.ts";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
const channelId = "attemptactions".padEnd(26, "0");
const thread = "attemptthread".padEnd(26, "0");
const refusal = {
  status: 403,
  code: "api.context.permissions.app_error",
  message: "Fixture refusal",
};
const corrected = " **correction**\n";

async function stage(account: Account, rootId?: string) {
  const changed = await account.saveDraft({
    channelId,
    rootId,
    expectedRevision: null,
    message: "Original fixture",
  });
  if (!changed.draft.revision) throw Error("Fixture has no saved revision");
  const next = await account.stagePost({
    channelId,
    rootId,
    revision: changed.draft.revision,
  });
  if (next.kind !== "created") throw Error("Fixture could not stage a message");
  return next.post;
}

export async function checkAttemptActions(
  account: Account,
  neighbor: Account,
  other: Account,
) {
  const first = await stage(account);
  if (
    first.attempt !== 1 ||
    first.refusal !== null ||
    (await other.recordPostRefusal(first, refusal)) !== null ||
    (await other.dismissPendingPost(first)) ||
    (await account.recordPostRefusal(first, refusal)) !== "delivery"
  )
    throw Error("Refusal must belong to the staged account and attempt");
  const correctedAttempts = await Promise.all(
    [account, neighbor].map((window) =>
      window.retryPendingPost(first, {
        kind: "afterRefusal",
        message: corrected,
      }),
    ),
  );
  const winner = correctedAttempts.find((post) => post !== null);
  if (
    correctedAttempts.filter(Boolean).length !== 1 ||
    !winner ||
    winner.attempt !== 2 ||
    winner.pendingId !== first.pendingId ||
    winner.message !== corrected ||
    (await neighbor.dismissPendingPost(first)) ||
    (await neighbor.recordPostRefusal(first, refusal)) !== null ||
    (await neighbor.recordPostRefusal(winner, refusal)) !== "delivery"
  )
    throw Error(
      "Competing retry decisions did not preserve the winning attempt",
    );
  const uncertain = await stage(account, thread);
  const retried = await account.retryPendingPost(uncertain, {
    kind: "despiteUnknownDelivery",
  });
  if (
    !retried ||
    (await account.recordPostRefusal(retried, refusal)) !== "retry" ||
    (await account.retryPendingPost(retried, {
      kind: "afterRefusal",
      message: "replace original",
    })) ||
    !(await account.dismissPendingPost(retried)) ||
    (await neighbor.dismissPendingPost(retried))
  )
    throw Error("An ambiguous retry or local dismissal lost its scope");
  await expectCode(
    account.recordPostRefusal(winner, { ...refusal, status: 502 }),
    "invalid_history_request",
  );
}

export async function checkAttemptRestore(account: Account, saved: boolean) {
  const [roots, replies] = await Promise.all([
    account.readPendingPosts({ channelId, after: 0, limit: 10 }),
    account.readPendingPosts({
      channelId,
      rootId: thread,
      after: 0,
      limit: 10,
    }),
  ]);
  const row = roots[0];
  if (
    replies.length ||
    (saved
      ? roots.length !== 1 ||
        !row ||
        row.attempt !== 2 ||
        row.message !== corrected ||
        row.refusal?.code !== refusal.code ||
        row.refusal.message !== refusal.message
      : roots.length)
  )
    throw Error(
      "The corrected refusal should survive only in the originating account",
    );
}
