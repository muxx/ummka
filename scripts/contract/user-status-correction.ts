import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/status.go#L25-L35
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/status.go#L25-L35
export function correctUserStatus(source: Fields, newer: Fields): Fields {
  const models = object(
    object(newer.components, "components").schemas,
    "schemas",
  );
  for (const model of [source, object(models.Status, "Status")]) {
    const fields = object(model.properties, "Status properties");
    if (
      model.type !== "object" ||
      !isDeepStrictEqual(fields.last_activity_at, {
        type: "integer",
        format: "int64",
      }) ||
      Object.hasOwn(fields, "dnd_end_time")
    )
      throw Error(
        "Review Status.dnd_end_time against the pinned Mattermost models",
      );
  }
  return {
    ...source,
    properties: {
      ...object(source.properties, "Status properties"),
      dnd_end_time: { type: "integer", format: "int64" },
    },
  };
}
