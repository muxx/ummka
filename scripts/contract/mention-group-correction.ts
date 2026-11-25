import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/group.go#L27-L43
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/group.go
export function correctMentionGroup(source: Fields, newer: Fields): Fields {
  const models = object(
    object(newer.components, "components").schemas,
    "schemas",
  );
  for (const model of [source, object(models.Group, "Group")]) {
    const fields = object(model.properties, "Group properties");
    if (
      model.type !== "object" ||
      Object.hasOwn(model, "required") ||
      !isDeepStrictEqual(fields.remote_id, { type: "string" }) ||
      !isDeepStrictEqual(fields.name, { type: "string" }) ||
      Object.hasOwn(fields, "allow_reference") ||
      Object.hasOwn(fields, "member_count")
    )
      throw Error("Review Group against the pinned Mattermost sources");
  }
  return {
    ...source,
    required: ["allow_reference", "remote_id"],
    properties: {
      ...object(source.properties, "Group properties"),
      allow_reference: { type: "boolean" },
      remote_id: { type: "string", nullable: true },
      member_count: { type: "integer" },
    },
  };
}
