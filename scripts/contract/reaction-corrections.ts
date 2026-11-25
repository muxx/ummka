import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both server models serialize these eight fields, including a nullable remote_id.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/reaction.go#L12-L20
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/reaction.go#L12-L20
export function correctReaction(source: Fields, newer: Fields): Fields {
  const schemas = object(
    object(newer.components, "components").schemas,
    "schemas",
  );
  const integer = { type: "integer", format: "int64" };
  const expected = {
    user_id: { type: "string" },
    post_id: { type: "string" },
    emoji_name: { type: "string" },
    create_at: integer,
  };
  for (const model of [source, object(schemas.Reaction, "Reaction")]) {
    const properties = Object.fromEntries(
      Object.entries(object(model.properties, "Reaction")).map(
        ([key, value]) => {
          const { description: _description, ...shape } = object(value, key);
          return [key, shape];
        },
      ),
    );
    if (
      model.type !== "object" ||
      Object.hasOwn(model, "required") ||
      !isDeepStrictEqual(properties, expected)
    )
      throw Error("Review Reaction against both pinned server models");
  }
  const properties = {
    ...object(source.properties, "Reaction"),
    channel_id: { type: "string" },
    update_at: integer,
    delete_at: integer,
    remote_id: { type: "string", nullable: true },
  };
  return { ...source, properties, required: Object.keys(properties) };
}
