import type { DraftLocation } from "../mattermost/native-rest.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

const localCommands = new Set([
  "/search",
  "/shortcuts",
  "/leave",
  "/settings",
  "/marketplace",
]);

export async function submitVisibleCommand(
  account: Pick<WorkspaceConnection, "submitDraftCommand">,
  location: DraftLocation & { teamId: string },
  draft: { message: string; revision: string },
  signal: AbortSignal,
  unauthorized: () => void,
) {
  signal.throwIfAborted();
  // The WebApp recognizes its local command up to the first ASCII space.
  const [name] = draft.message.split(" ", 1);
  const trigger = name.toLowerCase();
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
