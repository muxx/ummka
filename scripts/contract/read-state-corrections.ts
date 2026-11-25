import { type Fields, object } from "./objects.ts";

function jsonSchema(part: unknown, name: string) {
  const content = object(object(part, name).content, name);
  return object(object(content["application/json"], name).schema, name);
}

function viewTimes(operation: Fields) {
  const name = String(operation.operationId);
  const success = object(operation.responses, name)["200"];
  const fields = object(jsonSchema(success, name).properties, name);
  const times = object(fields.last_viewed_at_times, name);
  if (
    object(fields.status, name).type !== "string" ||
    times.type !== "object" ||
    "additionalProperties" in times
  )
    throw Error(`Review ${name} response against the pinned sources`);
  return times;
}

function viewInput(operation: Fields) {
  const schema = jsonSchema(operation.requestBody, "ViewChannel");
  const fields = object(schema.properties, "ViewChannel");
  if (
    operation.operationId !== "ViewChannel" ||
    schema.type !== "object" ||
    !Array.isArray(schema.required) ||
    !schema.required.includes("channel_id") ||
    object(fields.channel_id, "channel_id").type !== "string" ||
    object(fields.prev_channel_id, "prev_channel_id").type !== "string" ||
    "collapsed_threads_supported" in fields
  )
    throw Error("Review ViewChannel input against the pinned sources");
  return fields;
}

// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/channel_view.go
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/channel_view.go
export function correctChannelView(
  operation: Fields,
  referencePaths: Fields,
  path: string,
) {
  const reference = object(object(referencePaths[path], path).post, path);
  viewInput(reference);
  viewTimes(reference);
  const copy = structuredClone(operation);
  viewInput(copy).collapsed_threads_supported = { type: "boolean" };
  viewTimes(copy).additionalProperties = { type: "integer", format: "int64" };
  return copy;
}

// v10.10.1 implements the bulk route. v12.1.0 publishes the missing operation.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/channel.go#L1667-L1698
export function correctBulkChannelView(
  operation: Fields,
  baselinePaths: Fields,
  path: string,
) {
  const schema = jsonSchema(operation.requestBody, "MarkChannelsReadForUser");
  if (
    path in baselinePaths ||
    operation.operationId !== "MarkChannelsReadForUser" ||
    schema.type !== "array" ||
    object(schema.items, "channel ids").type !== "string"
  )
    throw Error("Review MarkChannelsReadForUser against the pinned sources");
  const copy = structuredClone(operation);
  viewTimes(copy).additionalProperties = { type: "integer", format: "int64" };
  return copy;
}
