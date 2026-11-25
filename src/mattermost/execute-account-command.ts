import {
  type CommandResponse,
  type CommandsApi,
  instanceOfCommandResponse,
} from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";
import { type MutationRefusal, mutationFailure } from "./mutation-error.ts";
import type { DraftLocation } from "./native-rest.ts";

type CommandResult =
  | { kind: "executed"; response: CommandResponse }
  | { kind: "unknownCommand"; refusal: MutationRefusal }
  | { kind: "refused"; refusal: MutationRefusal }
  | { kind: "unauthorized" }
  | { kind: "unconfirmed" };

function commandResponse(value: CommandResponse): boolean {
  if (!value || !instanceOfCommandResponse(value)) return false;
  const textFields = [
    value.responseType,
    value.text,
    value.username,
    value.channelId,
    value.iconUrl,
    value.type,
    value.gotoLocation,
    value.triggerId,
  ];
  const object = (item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item);
  return (
    textFields.every((field) => typeof field === "string") &&
    typeof value.skipSlackParsing === "boolean" &&
    (value.props === null || object(value.props)) &&
    (value.attachments === null ||
      (Array.isArray(value.attachments) &&
        value.attachments.every((item) => item === null || object(item)))) &&
    (value.extraResponses === null ||
      (Array.isArray(value.extraResponses) &&
        value.extraResponses.every(
          (item) => item === null || commandResponse(item),
        )))
  );
}

export async function executeAccountCommand(
  api: CommandsApi,
  location: DraftLocation & { teamId: string },
  text: string,
): Promise<CommandResult> {
  const { channelId, teamId, rootId } = location;
  if (
    !isMattermostId(channelId) ||
    !isMattermostId(teamId) ||
    (rootId !== undefined && !isMattermostId(rootId))
  )
    throw new TypeError("Invalid Mattermost command location.");
  if (!text.startsWith("/"))
    throw new TypeError("Expected a Mattermost slash command.");
  const space = text.search(/\s/u);
  const trigger = (space === -1 ? text : text.slice(0, space)).toLowerCase();
  const args = space === -1 ? "" : text.slice(space).trim();
  const command = (args ? trigger + " " + args : trigger).replaceAll("—", "--");
  try {
    const response = await api.executeCommand({
      executeCommandRequest: { command, teamId, channelId, rootId },
    });
    if (!commandResponse(response)) return { kind: "unconfirmed" };
    return { kind: "executed", response };
  } catch (error) {
    const failure = await mutationFailure(error);
    if (
      failure.kind === "refused" &&
      failure.refusal.status === 404 &&
      failure.refusal.code === "api.command.execute_command.not_found.app_error"
    )
      return { kind: "unknownCommand", refusal: failure.refusal };
    return failure;
  }
}
