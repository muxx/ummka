import type { ChannelPermission } from "../mattermost/channel-permissions.ts";
import { latestReactionTarget } from "./latest-reaction-target.ts";
import {
  postReactionBadges,
  postReactionDecision,
} from "./post-reaction-actions.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { channelPageSize } from "./workspace-data.ts";

type Account = Pick<
  WorkspaceConnection,
  | "readChannelWindow"
  | "readPostReactions"
  | "addOwnReaction"
  | "removeOwnReaction"
  | "saveDraft"
>;
type Context = {
  account: Account;
  channelId: string;
  userId: string;
  collapsedThreads: boolean | null;
  archived: boolean;
  add: ChannelPermission;
  remove: ChannelPermission;
  uniqueLimit?: string;
};
type Request = { action: "add" | "remove"; emoji: string };
type Draft = { revision: string; isCurrent(): boolean };

export async function submitChannelReaction(
  context: Context,
  request: Request,
  draft: Draft,
  signal: AbortSignal,
) {
  const { account, channelId, collapsedThreads } = context;
  signal.throwIfAborted();
  const online = () => navigator.onLine !== false;
  if (!online()) return { kind: "offline" } as const;
  if (collapsedThreads === null) return { kind: "historyUnknown" } as const;
  const page = await account.readChannelWindow({
    kind: "latest",
    channelId,
    collapsedThreads,
    limit: channelPageSize,
  });
  signal.throwIfAborted();
  if (!draft.isCurrent()) return { kind: "changed" } as const;
  if (!page) return { kind: "historyUnknown" } as const;
  const postId = latestReactionTarget(channelId, page.posts);
  if (!postId) return { kind: "noTarget" } as const;
  const rows = await account.readPostReactions(postId, signal);
  signal.throwIfAborted();
  if (!draft.isCurrent()) return { kind: "changed" } as const;
  const decision = postReactionDecision(
    postReactionBadges(postId, context.userId, rows),
    request.emoji,
    request.action,
    {
      online: online(),
      archived: context.archived,
      add: context.add,
      remove: context.remove,
      uniqueLimit:
        context.uniqueLimit === undefined
          ? undefined
          : BigInt(context.uniqueLimit),
    },
  );
  if (decision !== "add" && decision !== "remove")
    return { kind: decision } as const;
  if (decision === "add")
    await account.addOwnReaction(postId, request.emoji, signal);
  else await account.removeOwnReaction(postId, request.emoji, signal);
  // A confirmed change still belongs to its original conversation if the user has switched panes.
  // Compare-and-save prevents both a replacement draft and newer text in another window being cleared.
  if (!draft.isCurrent()) return { kind: "applied", action: decision } as const;
  try {
    await account.saveDraft({
      channelId,
      expectedRevision: draft.revision,
      message: "",
    });
  } catch (error) {
    if (error !== "history_storage_unavailable") throw error;
    return { kind: "appliedWithDraftError", action: decision } as const;
  }
  return { kind: "applied", action: decision } as const;
}
