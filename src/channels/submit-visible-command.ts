import type { DraftLocation } from "../mattermost/native-rest.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

const localCommands = new Set([
  "/shortcuts",
  "/leave",
  "/settings",
  "/marketplace",
]);

export type OpenCommandSearch = (
  terms: string,
  origin: AbortSignal,
  onOpened: () => void,
) => Promise<boolean>;

export async function submitVisibleCommand(
  account: Pick<WorkspaceConnection, "submitDraftCommand" | "saveDraft">,
  location: DraftLocation & { teamId: string },
  draft: { message: string; revision: string; isCurrent: () => boolean },
  signal: AbortSignal,
  unauthorized: () => void,
  openSearch: OpenCommandSearch,
) {
  signal.throwIfAborted();
  // The WebApp recognizes its local command up to the first ASCII space.
  const [name] = draft.message.split(" ", 1);
  const trigger = name.toLowerCase();
  if (trigger === "/search") {
    let cleared: ReturnType<typeof account.saveDraft> | undefined;
    await openSearch(draft.message.slice(name.length + 1), signal, () => {
      // Replacing the detail pane unmounts the originating thread editor.
      if (!signal.aborted && draft.isCurrent())
        cleared = account.saveDraft({
          channelId: location.channelId,
          rootId: location.rootId,
          expectedRevision: draft.revision,
          message: "",
        });
    });
    await cleared;
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
