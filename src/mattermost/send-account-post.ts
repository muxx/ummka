import type { Post, PostsApi } from "../../vendor/mattermost/index.js";
import type {
  PendingPost,
  PostRefusal,
  RefusalScope,
} from "./account-delivery.ts";
import { isMattermostId } from "./model-fields.ts";
import { mutationFailure } from "./mutation-error.ts";

type DeliveryResult =
  | { kind: "accepted"; post: Post; matched: boolean }
  | { kind: "refused"; refusal: PostRefusal }
  | { kind: "unconfirmed"; retryRefusal?: PostRefusal }
  | { kind: "unauthorized" };

type Receipts = {
  confirmPostDelivery(
    source: { kind: "response"; requestPendingId: string },
    post: Post,
  ): Promise<boolean>;
  recordPostRefusal(
    post: PendingPost,
    refusal: PostRefusal,
  ): Promise<RefusalScope | null>;
};

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
        ...(pending.files.length > 0 && {
          fileIds: pending.files.map((file) => file.id),
        }),
      },
    });
  } catch (error) {
    const result = await mutationFailure(error);
    if (result.kind !== "refused") return result;
    const scope = await receipts.recordPostRefusal(pending, result.refusal);
    if (scope === "delivery") return result;
    if (scope === "retry")
      return { kind: "unconfirmed", retryRefusal: result.refusal };
    return { kind: "unconfirmed" };
  }
  // A deduplicated CreatePost can return the saved post without its request key.
  if (
    !post ||
    !isMattermostId(post.id) ||
    post.userId !== userId ||
    post.channelId !== pending.channelId ||
    post.rootId !== (pending.rootId ?? "") ||
    post.rootId === post.id ||
    post.deleteAt !== 0 ||
    (post.pendingPostId !== undefined &&
      post.pendingPostId !== "" &&
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
