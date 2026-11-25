import { type Fields, object } from "./objects.ts";

const id = "GetChannelMemberCountsByGroup";
const groupModel = "ChannelMemberCountByGroup";
const path = "/api/v4/channels/{channel_id}/member_counts_by_group";

// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/channel.go#L2172-L2206
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/channel.go#L3100-L3134
export function correctGroupAudienceResponse(
  source: Fields,
  newer: Fields,
): Fields {
  const result = structuredClone(source);
  function success(operation: Fields) {
    const response = object(object(operation.responses, id)["200"], id);
    if (
      operation.operationId !== id ||
      typeof response.description !== "string" ||
      Object.keys(response).length !== 1
    )
      throw Error("Review GetChannelMemberCountsByGroup on both pins");
    return response;
  }
  success(object(object(newer[path], path).get, id));
  success(result).content = {
    "application/json": {
      schema: {
        type: "array",
        items: { $ref: "#/components/schemas/ChannelMemberCountByGroup" },
      },
    },
  };
  return result;
}

// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/channel.go#L240-L244
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/channel.go#L309-L313
export function correctGroupAudienceModel(
  source: Fields,
  newer: Fields,
): Fields {
  const schemas = object(
    object(newer.components, "components").schemas,
    "schemas",
  );
  const counters = ["channel_member_count", "channel_member_timezones_count"];
  for (const model of [source, object(schemas[groupModel], groupModel)]) {
    const props = object(model.properties, groupModel);
    if (
      model.type !== "object" ||
      Object.hasOwn(model, "required") ||
      object(props.group_id, "group_id").type !== "string" ||
      counters.some((key) => object(props[key], key).type !== "number")
    )
      throw Error("Review ChannelMemberCountByGroup on both pins");
  }
  const properties = { ...object(source.properties, groupModel) };
  for (const key of counters)
    properties[key] = {
      ...object(properties[key], key),
      type: "integer",
      format: "int64",
    };
  return { ...source, properties, required: ["group_id", ...counters] };
}
