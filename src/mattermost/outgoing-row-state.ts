import type { PendingPost, PostRefusal } from "./account-delivery.ts";

type SavedOutcome =
  | { kind: "refused"; refusal: PostRefusal }
  | { kind: "unconfirmed"; retryRefusal: PostRefusal | null };

type Action =
  | "checkDelivery"
  | "retry"
  | "edit"
  | "sendEdited"
  | "copy"
  | "dismiss";
type RowState = (
  | SavedOutcome
  | { kind: "previousLogin"; outcome: SavedOutcome }
  | { kind: "delivered"; postId: string }
  | { kind: "sending" }
) & {
  /** Absent actions are hidden. False keeps a network action visible while offline. */
  actions: Readonly<Partial<Record<Action, boolean>>>;
};

export function outgoingRowState(
  post: PendingPost,
  sending: boolean,
  online: boolean,
): RowState {
  if (post.confirmedPostId !== null)
    return { kind: "delivered", postId: post.confirmedPostId, actions: {} };

  const outcome: SavedOutcome =
    post.refusal !== null
      ? { kind: "refused", refusal: post.refusal }
      : { kind: "unconfirmed", retryRefusal: post.retryRefusal ?? null };
  if (post.previousLogin)
    return {
      kind: "previousLogin",
      outcome,
      actions: { copy: true, dismiss: true },
    };
  if (outcome.kind === "refused")
    return {
      ...outcome,
      actions: { edit: true, sendEdited: online, dismiss: true },
    };
  if (sending && !outcome.retryRefusal) return { kind: "sending", actions: {} };
  return {
    ...outcome,
    actions: {
      checkDelivery: online,
      retry: online,
      ...(outcome.retryRefusal && { copy: true }),
      dismiss: true,
    },
  };
}
