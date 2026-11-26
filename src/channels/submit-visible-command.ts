import type { DraftLocation } from "../mattermost/native-rest.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

const localCommands = new Set([
  "/shortcuts",
  "/leave",
  "/settings",
  "/marketplace",
]);

export async function submitVisibleCommand(
  account: Pick<WorkspaceConnection, "submitDraftCommand" | "saveDraft">,
  location: DraftLocation & { teamId: string },
  draft: { message: string; revision: string; isCurrent: () => boolean },
  signal: AbortSignal,
  unauthorized: () => void,
  openSearch: (terms: string, origin: AbortSignal) => Promise<boolean>,
) {
  signal.throwIfAborted();
  // The WebApp recognizes its local command up to the first ASCII space.
  const [name] = draft.message.split(" ", 1);
  const trigger = name.toLowerCase();
  if (trigger === "/search") {
    const opened = await openSearch(
      draft.message.slice(name.length + 1),
      signal,
    );
    if (opened && !signal.aborted && draft.isCurrent()) {
      await account.saveDraft({
        channelId: location.channelId,
        rootId: location.rootId,
        expectedRevision: draft.revision,
        message: "",
      });
    }
    return { kind: "search" } as const;
  }
  if (localCommands.has(trigger))
    return { kind: "localCommand", trigger } as const;
  const answer = await account.submitDraftCommand(location, draft.revision);
  if (
    !signal.aborted &&
    answer.kind === "answered" &&
    answer.result.kind === "unauthorized"
  )
    unauthorized();
  return { kind: "command", answer } as const;
}
