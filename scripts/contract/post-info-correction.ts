import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both servers implement this read. v12.1.0 documents the missing v10 operation and model.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/post.go#L1311-L1329
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/post_info.go#L6-L15
export function checkPostInfoOperation(
  baseline: Fields,
  path: string,
  operation: Fields,
) {
  const responses = object(operation.responses, "GetPostInfo responses");
  const success = object(responses["200"], "GetPostInfo success");
  const content = object(success.content, "GetPostInfo content");
  const json = object(content["application/json"], "GetPostInfo JSON");
  if (
    Object.hasOwn(baseline, path) ||
    Object.hasOwn(operation, "security") ||
    !Array.isArray(operation.parameters) ||
    operation.parameters.length !== 1 ||
    !isDeepStrictEqual(json.schema, { $ref: "#/components/schemas/PostInfo" })
  )
    throw Error("Review the GetPostInfo correction against the pinned sources");
}

export function postInfoSchema(baseline: Fields, reference: Fields): Fields {
  const components = object(reference.components, "v12 components");
  const schemas = object(components.schemas, "v12 schemas");
  const info = object(schemas.PostInfo, "v12 PostInfo");
  const properties = object(info.properties, "PostInfo properties");
  const types = Object.fromEntries(
    Object.entries(properties).map(([name, field]) => [
      name,
      object(field, name).type,
    ]),
  );
  if (
    Object.hasOwn(baseline, "PostInfo") ||
    info.type !== "object" ||
    !isDeepStrictEqual(types, {
      channel_id: "string",
      channel_type: "string",
      channel_display_name: "string",
      has_joined_channel: "boolean",
      team_id: "string",
      team_type: "string",
      team_display_name: "string",
      has_joined_team: "boolean",
    })
  )
    throw Error("Review the PostInfo correction against the pinned sources");
  return info;
}
