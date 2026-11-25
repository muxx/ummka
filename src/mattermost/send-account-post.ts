import {
  AppErrorFromJSON,
  FetchError,
  type Post,
  type PostsApi,
  ResponseError,
} from "../../vendor/mattermost/index.js";
import type { PendingPost, PostRefusal } from "./account-delivery.ts";
import { isMattermostId } from "./model-fields.ts";

type DeliveryResult =
  | { kind: "accepted"; post: Post; matched: boolean }
  | { kind: "refused"; refusal: PostRefusal }
  | { kind: "unconfirmed" }
  | { kind: "unauthorized" };

type Receipts = {
  confirmPostDelivery(
    source: { kind: "response"; requestPendingId: string },
    post: Post,
  ): Promise<boolean>;
  recordPostRefusal(post: PendingPost, refusal: PostRefusal): Promise<boolean>;
};

async function refusedRequest(
  response: Response,
  pending: PendingPost,
  receipts: Receipts,
): Promise<DeliveryResult> {
  if (
    response.status === 401 ||
    response.status < 400 ||
    response.status >= 500
  ) {
    // The authoritative status does not require consuming its diagnostic body.
    void response.body?.cancel().catch(() => {});
    return { kind: response.status === 401 ? "unauthorized" : "unconfirmed" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "unconfirmed" };
  }
  const error = AppErrorFromJSON(body);
  if (
    error?.statusCode !== response.status ||
    typeof error.id !== "string" ||
    !error.id.trim()
  ) {
    return { kind: "unconfirmed" };
  }
  const refusal = {
    status: response.status,
    code: error.id,
    message: typeof error.message === "string" ? error.message : null,
  };
  return (await receipts.recordPostRefusal(pending, refusal))
    ? { kind: "refused", refusal }
    : { kind: "unconfirmed" };
}

/** Called only after this connection wins the local draft or retry transaction. */
export async function deliverAccountPost(
  posts: Pick<PostsApi, "createPost">,
  userId: string,
  pending: PendingPost,
  receipts: Receipts,
): Promise<DeliveryResult> {
  let post: Post;
  try {
    post = await posts.createPost({
      createPostRequest: {
        channelId: pending.channelId,
        message: pending.message,
        pendingPostId: pending.pendingId,
        ...(pending.rootId !== null && { rootId: pending.rootId }),
      },
    });
  } catch (error) {
    if (error instanceof ResponseError)
      return refusedRequest(error.response, pending, receipts);
    if (error instanceof FetchError && error.cause instanceof Error) {
      const reason = error.cause.cause;
      if (
        reason === "cancelled" ||
        reason === "unknown_connection" ||
        reason === "session_unavailable"
      )
        throw reason;
    }
    if (
      error instanceof FetchError ||
      error instanceof SyntaxError ||
      error instanceof TypeError
    )
      return { kind: "unconfirmed" };
    throw error;
  }
  if (
    !post ||
    !isMattermostId(post.id) ||
    post.userId !== userId ||
    post.channelId !== pending.channelId ||
    post.rootId !== (pending.rootId ?? "") ||
    post.rootId === post.id ||
    post.deleteAt !== 0 ||
    (post.pendingPostId !== undefined &&
      post.pendingPostId !== pending.pendingId)
  ) {
    return { kind: "unconfirmed" };
  }
  const matched = await receipts.confirmPostDelivery(
    { kind: "response", requestPendingId: pending.pendingId },
    post,
  );
  return { kind: "accepted", post, matched };
}
