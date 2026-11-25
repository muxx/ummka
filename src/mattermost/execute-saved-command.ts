import type { CommandsApi } from "../../vendor/mattermost/index.js";
import { executeAccountCommand } from "./execute-account-command.ts";
import { isMattermostId } from "./model-fields.ts";
import type { DraftLocation, DraftSave } from "./native-rest.ts";

type CommandLocation = DraftLocation & { teamId: string };
export type CommandIntent = "firstAttempt" | "repeatAfterConfirmation";
type Transition = (
  location: DraftLocation & { revision: string },
  action: "start" | "restart" | "complete" | "release",
) => Promise<DraftSave>;

export async function executeSavedCommand(
  api: CommandsApi,
  transition: Transition,
  location: CommandLocation,
  revision: string,
  intent: CommandIntent = "firstAttempt",
) {
  if (!isMattermostId(location.teamId))
    throw new TypeError("Invalid Mattermost team.");
  if (navigator.onLine === false) return { kind: "offline" } as const;
  const claim = await transition(
    { ...location, revision },
    intent === "repeatAfterConfirmation" ? "restart" : "start",
  );
  if (claim.kind === "conflict")
    return { kind: "conflict", draft: claim.draft } as const;
  if (!claim.draft.revision || !claim.draft.commandPending)
    throw new Error("Missing draft command attempt.");
  const attemptRevision = claim.draft.revision;
  const result = await executeAccountCommand(
    api,
    location,
    claim.draft.message,
  );
  if (result.kind === "unconfirmed") return { ...result, attemptRevision };
  try {
    const finished = await transition(
      { ...location, revision: attemptRevision },
      result.kind === "executed" ? "complete" : "release",
    );
    return {
      kind: "answered",
      attemptRevision,
      result,
      settlement: finished.kind,
      draft: finished.draft,
    } as const;
  } catch (error) {
    if (error !== "history_storage_unavailable") throw error;
    return {
      kind: "answered",
      attemptRevision,
      result,
      settlement: "storageUnavailable",
    } as const;
  }
}
