import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both servers serialize the six fields even when creator_id is empty or delete_at is zero.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/emoji.go#L19-L26
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/emoji.go#L19-L26
export function correctCustomEmoji(source: Fields, newer: Fields): Fields {
  const schemas = object(
    object(newer.components, "components").schemas,
    "schemas",
  );
  const text = { type: "string" };
  const time = { type: "integer", format: "int64" };
  const expected = {
    id: text,
    creator_id: text,
    name: text,
    create_at: time,
    update_at: time,
    delete_at: time,
  };
  for (const model of [source, object(schemas.Emoji, "Emoji")]) {
    const properties = Object.fromEntries(
      Object.entries(object(model.properties, "Emoji")).map(([name, field]) => {
        const { description: _description, ...shape } = object(field, name);
        return [name, shape];
      }),
    );
    if (
      model.type !== "object" ||
      Object.hasOwn(model, "required") ||
      !isDeepStrictEqual(properties, expected)
    )
      throw Error("Review Emoji against both pinned server models");
  }
  return { ...source, required: Object.keys(expected) };
}
