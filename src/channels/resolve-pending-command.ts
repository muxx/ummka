import type { DraftLocation } from "../mattermost/native-rest.ts";
import type { ActionFeedback } from "./draft-action-feedback.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

export type PendingCommandAction = "repeat" | "edit" | "clear";

export async function resolvePendingCommand(
  account: Pick<
    WorkspaceConnection,
    "submitDraftCommand" | "saveDraft" | "transitionDraftCommand"
  >,
  location: DraftLocation & { teamId: string },
  revision: string,
  action: PendingCommandAction,
): Promise<ActionFeedback> {
  if (action === "repeat") {
    const answer = await account.submitDraftCommand(
      location,
      revision,
      "repeatAfterConfirmation",
    );
    return { kind: "command", answer };
  }
  const result =
    action === "edit"
      ? await account.transitionDraftCommand(
          { ...location, revision },
          "release",
        )
      : await account.saveDraft({
          ...location,
          expectedRevision: revision,
          message: "",
        });
  return result.kind === "conflict"
    ? { kind: "command", answer: { kind: "conflict", draft: result.draft } }
    : { kind: "changedPendingCommand", action };
}
