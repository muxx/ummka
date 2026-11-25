import { invoke } from "@tauri-apps/api/core";
import type { Post } from "../../vendor/mattermost/index.js";

import type { ComposerDraft, DraftLocation, DraftSave } from "./native-rest.ts";

type PostRefusal = { status: number; code: string; message: string | null };
type AttemptKey = { pendingId: string; attempt: number };
type RetryChoice =
  | { kind: "despiteUnknownDelivery" }
  | { kind: "afterRefusal"; message: string };

type PendingPost = {
  sequence: number;
  pendingId: string;
  channelId: string;
  rootId: string | null;
  message: string;
  createdAt: number;
  previousLogin: boolean;
  confirmedPostId: string | null;
  attempt: number;
  refusal: PostRefusal | null;
};
type StagePost =
  | { kind: "created"; post: PendingPost; draft: ComposerDraft }
  | { kind: "notStaged"; draft: ComposerDraft };
type DeliverySource =
  | { kind: "posted" }
  | { kind: "response"; requestPendingId: string };

export function accountDelivery(
  rid: number,
  whileOpen: <T>(operation: () => Promise<T>) => Promise<T>,
) {
  return {
    readDraft({ channelId, rootId }: DraftLocation) {
      return whileOpen(() =>
        invoke<ComposerDraft>("read_composer_draft", {
          rid,
          channelId,
          rootId: rootId ?? null,
        }),
      );
    },
    saveDraft({
      channelId,
      rootId,
      expectedRevision,
      message,
    }: DraftLocation & {
      expectedRevision: string | null;
      message: string;
    }) {
      return whileOpen(() =>
        invoke<DraftSave>("save_composer_draft", {
          rid,
          channelId,
          rootId: rootId ?? null,
          expectedRevision,
          message,
        }),
      );
    },
    stagePost({
      channelId,
      rootId,
      revision,
    }: DraftLocation & { revision: string }) {
      return whileOpen(() =>
        invoke<StagePost>("stage_composer_post", {
          rid,
          channelId,
          rootId: rootId ?? null,
          revision,
        }),
      );
    },
    readPendingPosts({
      channelId,
      rootId,
      after,
      limit,
    }: DraftLocation & { after: number; limit: number }) {
      return whileOpen(() =>
        invoke<PendingPost[]>("read_pending_posts", {
          rid,
          channelId,
          rootId: rootId ?? null,
          after,
          limit,
        }),
      );
    },
    confirmPostDelivery(source: DeliverySource, post: Post) {
      return whileOpen(async () => {
        // Deleted or incomplete posts cannot identify an accepted send.
        if (
          post.deleteAt !== 0 ||
          !post.id ||
          !post.userId ||
          !post.channelId ||
          typeof post.rootId !== "string"
        )
          return false;
        return invoke<boolean>("confirm_post_delivery", {
          rid,
          source,
          wirePendingId: post.pendingPostId ?? null,
          post: {
            id: post.id,
            userId: post.userId,
            channelId: post.channelId,
            rootId: post.rootId || null,
          },
        });
      });
    },
    retireDeliveredPosts(postIds: string[]) {
      return whileOpen(() =>
        invoke<number>("retire_delivered_posts", { rid, postIds }),
      );
    },
    recordPostRefusal(
      { pendingId, attempt }: AttemptKey,
      refusal: PostRefusal,
    ) {
      return whileOpen(() =>
        invoke<boolean>("record_post_refusal", {
          rid,
          pendingId,
          attempt,
          refusal,
        }),
      );
    },
    retryPendingPost({ pendingId, attempt }: AttemptKey, choice: RetryChoice) {
      return whileOpen(() =>
        invoke<PendingPost | null>("retry_pending_post", {
          rid,
          pendingId,
          attempt,
          choice,
        }),
      );
    },
    dismissPendingPost({ pendingId, attempt }: AttemptKey) {
      return whileOpen(() =>
        invoke<boolean>("dismiss_pending_post", { rid, pendingId, attempt }),
      );
    },
  };
}
