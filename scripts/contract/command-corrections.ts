import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

const commandRoute = "/api/v4/commands/execute";
const commandResponseRef = { $ref: "#/components/schemas/CommandResponse" };

function jsonSchema(body: unknown) {
  const content = object(
    object(body, "command body").content,
    "command content",
  );
  return object(
    object(content["application/json"], "command JSON").schema,
    "command schema",
  );
}

// Both handlers resolve the caller from the session and accept team_id and root_id.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/command.go#L310-L372
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/command_args.go
export function correctExecuteCommand(
  operation: Fields,
  reference: Fields,
): Fields {
  const newer = object(
    object(reference[commandRoute], commandRoute).post,
    "v12 ExecuteCommand",
  );
  const result = structuredClone(operation);
  for (const version of [newer, result]) {
    const input = jsonSchema(version.requestBody);
    const fields = object(input.properties, "command inputs");
    const responses = object(version.responses, "command responses");
    if (
      version.operationId !== "ExecuteCommand" ||
      object(version.requestBody, "command request").required !== true ||
      input.type !== "object" ||
      !isDeepStrictEqual(input.required, ["channel_id", "command"]) ||
      !isDeepStrictEqual(Object.keys(fields).sort(), [
        "channel_id",
        "command",
      ]) ||
      Object.values(fields).some(
        (entry) => object(entry, "command input").type !== "string",
      ) ||
      !isDeepStrictEqual(jsonSchema(responses["200"]), commandResponseRef) ||
      Object.hasOwn(responses, "404")
    )
      throw Error("Review ExecuteCommand against the pinned source");
  }
  Object.assign(
    object(jsonSchema(result.requestBody).properties, "command inputs"),
    {
      team_id: { type: "string" },
      root_id: { type: "string" },
    },
  );
  const responses = object(result.responses, "command responses");
  const success = jsonSchema(responses["200"]);
  // A successful execution returns an object. Only recursive list entries may be null.
  delete success.$ref;
  Object.assign(success, { type: "object", allOf: [commandResponseRef] });
  responses["404"] = {
    $ref: "#/components/responses/NotFound",
  };
  return result;
}

// Both tags encode this Go struct directly in a successful response.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/command_response.go#L18-L36
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/command_response.go#L18-L36
export function correctCommandResponse(
  source: Fields,
  reference: Fields,
): Fields {
  const schemas = object(
    object(reference.components, "v12 components").schemas,
    "v12 schemas",
  );
  const string = { type: "string" };
  const documented = (attachment: string) => ({
    type: "object",
    properties: {
      ResponseType: {
        description: "The response type either in_channel or ephemeral",
        type: "string",
      },
      Text: string,
      Username: string,
      IconURL: string,
      GotoLocation: string,
      Attachments: {
        type: "array",
        items: { $ref: `#/components/schemas/${attachment}` },
      },
    },
  });
  if (
    !isDeepStrictEqual(source, documented("SlackAttachment")) ||
    !isDeepStrictEqual(schemas.CommandResponse, documented("MessageAttachment"))
  )
    throw Error("Review CommandResponse against both pinned definitions");

  const jsonObject = { type: "object", additionalProperties: true };
  const properties = {
    response_type: string,
    text: string,
    username: string,
    channel_id: string,
    icon_url: string,
    type: string,
    props: { ...jsonObject, nullable: true },
    goto_location: string,
    trigger_id: string,
    skip_slack_parsing: { type: "boolean" },
    attachments: {
      type: "array",
      nullable: true,
      items: { ...jsonObject, nullable: true },
    },
    extra_responses: {
      type: "array",
      nullable: true,
      items: { type: "object", nullable: true, allOf: [commandResponseRef] },
    },
  };
  return {
    type: "object",
    nullable: true,
    required: Object.keys(properties),
    properties,
  };
}
