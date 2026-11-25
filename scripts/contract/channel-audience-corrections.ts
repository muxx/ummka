import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

const statsPath = "/api/v4/channels/{channel_id}/stats";

// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/channel.go#L684-L733
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/channel.go#L1176-L1225
export function correctChannelStatsQuery(
  source: Fields,
  newer: Fields,
): Fields {
  const next = object(
    object(newer[statsPath], statsPath).get,
    "GetChannelStats",
  );
  for (const operation of [source, next]) {
    const success = object(
      object(operation.responses, "responses")["200"],
      "200",
    );
    const json = object(
      object(success.content, "content")["application/json"],
      "JSON",
    );
    const parameters = operation.parameters;
    if (
      operation.operationId !== "GetChannelStats" ||
      !isDeepStrictEqual(json.schema, {
        $ref: "#/components/schemas/ChannelStats",
      }) ||
      !Array.isArray(parameters) ||
      parameters.some(
        (param) =>
          object(param, "channel stats parameter").name ===
          "exclude_files_count",
      )
    )
      throw Error("Review GetChannelStats against the pinned sources");
  }
  return {
    ...source,
    parameters: [
      ...(source.parameters as unknown[]),
      {
        name: "exclude_files_count",
        in: "query",
        schema: { type: "boolean" },
        description: "Skip the file count and return -1 in files_count.",
      },
    ],
  };
}

// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/channel_stats.go#L6-L12
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/channel_stats.go#L6-L12
export function correctChannelStats(source: Fields, newer: Fields): Fields {
  const schemas = object(
    object(newer.components, "components").schemas,
    "schemas",
  );
  const extra = ["guest_count", "pinnedpost_count", "files_count"];
  for (const model of [source, object(schemas.ChannelStats, "ChannelStats")]) {
    const props = object(model.properties, "ChannelStats properties");
    if (
      model.type !== "object" ||
      Object.hasOwn(model, "required") ||
      !isDeepStrictEqual(props.channel_id, { type: "string" }) ||
      !isDeepStrictEqual(props.member_count, { type: "integer" }) ||
      extra.some((key) => Object.hasOwn(props, key))
    )
      throw Error("Review ChannelStats against the pinned sources");
  }
  const properties = {
    ...object(source.properties, "ChannelStats properties"),
  };
  for (const name of extra)
    properties[name] = { type: "integer", format: "int64" };
  return {
    ...source,
    properties,
    required: ["channel_id", "member_count", ...extra],
  };
}
