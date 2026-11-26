import type { ChannelPermission } from "../mattermost/channel-permissions.ts";
import type { DraftLocation } from "../mattermost/native-rest.ts";
import { latestReactionTarget } from "./latest-reaction-target.ts";
import {
  postReactionBadges,
  postReactionDecision,
} from "./post-reaction-actions.ts";
import type { openThreadReplyWindow } from "./thread-reply-window.ts";
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
  thread?: ReactionThread;
  archived: boolean;
  add: ChannelPermission;
  remove: ChannelPermission;
  uniqueLimit?: string;
};
type Request = { action: "add" | "remove"; emoji: string };
type Draft = {
  location: Readonly<DraftLocation>;
  revision: string;
  isCurrent(): boolean;
};
export type ReactionThread = Pick<
  ReturnType<typeof openThreadReplyWindow>,
  "getSnapshot"
>;
type ThreadState = ReturnType<ReactionThread["getSnapshot"]>;

function ownsThread(
  state: ThreadState,
  channelId: string,
  rootId: string | undefined,
) {
  return (
    state.root !== null &&
    state.root.channelId === channelId &&
    state.root.id === rootId &&
    state.root.rootId === null &&
    state.up.status !== "inaccessible" &&
    state.down.status !== "inaccessible"
  );
}

// Replies in the open thread run from oldest to newest. A partial prefix can hide a
// newer eligible reply than the root, even when the visible suffix has only system rows.
function threadTarget(state: ThreadState, channelId: string, rootId: string) {
  if (state.down.status !== "end" || !state.root) return undefined;
  const newest = latestReactionTarget(
    channelId,
    state.replies,
    rootId,
    "oldestFirst",
  );
  if (newest) return newest;
  return state.up.status === "end"
    ? latestReactionTarget(channelId, [state.root], rootId)
    : undefined;
}

export async function submitChannelReaction(
  context: Context,
  request: Request,
  draft: Draft,
  signal: AbortSignal,
) {
  const { account, channelId, collapsedThreads, thread } = context;
  const { rootId } = draft.location;
  const { revision } = draft;
  signal.throwIfAborted();
  const online = () => navigator.onLine !== false;
  if (!online()) return { kind: "offline" } as const;
  if (
    channelId !== draft.location.channelId ||
    Boolean(thread) !== (rootId !== undefined) ||
    !draft.isCurrent()
  )
    return { kind: "changed" } as const;
  if (collapsedThreads === null) return { kind: "historyUnknown" } as const;
  const current = () =>
    draft.isCurrent() &&
    (!thread || ownsThread(thread.getSnapshot(), channelId, rootId));
  let postId: string | null | undefined;
  if (thread && rootId !== undefined) {
    const state = thread.getSnapshot();
    if (!state.root) return { kind: "historyUnknown" } as const;
    if (!ownsThread(state, channelId, rootId))
      return { kind: "changed" } as const;
    postId = threadTarget(state, channelId, rootId);
  } else {
    const page = await account.readChannelWindow({
      kind: "latest",
      channelId,
      collapsedThreads,
      limit: channelPageSize,
    });
    postId = page ? latestReactionTarget(channelId, page.posts) : undefined;
  }
  signal.throwIfAborted();
  if (!current()) return { kind: "changed" } as const;
  if (postId === undefined) return { kind: "historyUnknown" } as const;
  if (!postId) return { kind: "noTarget" } as const;
  const rows = await account.readPostReactions(postId, signal);
  signal.throwIfAborted();
  if (!current()) return { kind: "changed" } as const;
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
  if (signal.aborted || !current())
    return { kind: "applied", action: decision } as const;
  try {
    await account.saveDraft({
      channelId,
      rootId,
      expectedRevision: revision,
      message: "",
    });
  } catch (error) {
    if (error !== "history_storage_unavailable") throw error;
    return { kind: "appliedWithDraftError", action: decision } as const;
  }
  return { kind: "applied", action: decision } as const;
}
